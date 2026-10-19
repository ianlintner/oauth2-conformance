/**
 * Response comparison: decide whether an actual HTTP response satisfies a
 * scenario expectation.
 *
 * Extracted from typescript-oauth2-server `src/conformance/runner.ts`
 * (@d1999bf) and split out so the black-box false-PASS self-tests can exercise
 * it directly. Semantics preserved:
 *  - a declared `expect.status` must match exactly;
 *  - declared `expect.headers` must be present, case-insensitively, with
 *    exact (post-interpolation) values;
 *  - declared `expect.json` keys must be present and deep-equal after
 *    normalization;
 *  - `expect.jsonSchema` is an additional constraint on the normalized body;
 *  - `expect.redirect` asserts the Location and its query/fragment pairs.
 *
 * Every difference is reported as a structured diff, so a failure explains
 * itself instead of raising an opaque assertion error.
 */

import { NORMALIZED, normalizePayload } from './normalize.js';
import type { ScenarioExpectation } from './scenario.js';
import { interpolate } from './scenario.js';
import { isAbsentMatcher, isContainsMatcher, isNonemptyMatcher, isGtMatcher, isLtMatcher, isIncludesMatcher } from './matchers.js';
import { decodeJwtSegments, fieldAt } from './jwt.js';

/** Minimal view of the run's captured-value scope (`Map<string, string>`). */
export interface CaptureScope {
  get(name: string): string | undefined;
}

export interface ActualResponse {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON body, or `undefined` when the body was not JSON. */
  body: unknown;
  /** Raw response body text, for bodies that are not JSON. */
  text?: string;
  /** Effective redirect target parsed from the Location header, when present. */
  redirect?: { location: string; query: Record<string, string>; fragment: Record<string, string> };
}

export interface Diff {
  path: string;
  expected: unknown;
  actual: unknown;
  reason: string;
}

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function isNormalized(value: unknown): boolean {
  return value === NORMALIZED;
}

/**
 * Recursively resolve `{{name}}` references in `expect.json`/`expect.headers`
 * string leaves against the run's capture scope, leaving matcher nodes and
 * non-string values untouched. A string that contains no `{{...}}` reference
 * is returned unchanged.
 */
function interpolateLeaves(value: unknown, scope?: CaptureScope): unknown {
  if (scope === undefined) return value;
  if (typeof value === 'string') return value.includes('{{') ? interpolate(value, scope) : value;
  if (Array.isArray(value)) return value.map((entry) => interpolateLeaves(entry, scope));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, interpolateLeaves(entry, scope)]));
  }
  return value;
}

/** Structural comparison where an expected `NORMALIZED` matches anything present. */
function deepDiff(expected: unknown, actual: unknown, path: string, diffs: Diff[]): void {
  if (isNormalized(expected)) {
    if (actual === undefined) {
      diffs.push({ path, expected: '<nondeterministic value>', actual, reason: 'missing required field' });
    }
    return;
  }
  // Declarative matchers relax the otherwise-exact shape for RFC needs that a
  // strict deep-equal cannot express. Matcher nodes appear only in `expect.json`.
  if (isContainsMatcher(expected)) {
    const needle = (expected as { $contains: unknown }).$contains;
    if (!Array.isArray(actual) || !actual.includes(needle)) {
      diffs.push({ path, expected: `$contains ${JSON.stringify(needle)}`, actual, reason: 'array does not contain the expected value' });
    }
    return;
  }
  if (isNonemptyMatcher(expected)) {
    if (!Array.isArray(actual) || actual.length === 0) {
      diffs.push({ path, expected: '$nonempty', actual, reason: 'expected a non-empty array' });
    }
    return;
  }
  if (isIncludesMatcher(expected)) {
    const needle = (expected as { $includes: unknown }).$includes;
    if (typeof actual === 'string' && !actual.includes(String(needle))) {
      diffs.push({ path, expected: `$includes ${JSON.stringify(needle)}`, actual, reason: 'string does not contain the expected substring' });
    } else if (Array.isArray(actual) && !actual.includes(needle)) {
      diffs.push({ path, expected: `$includes ${JSON.stringify(needle)}`, actual, reason: 'array does not contain the expected value' });
    } else if (typeof actual !== 'string' && !Array.isArray(actual)) {
      diffs.push({ path, expected: `$includes ${JSON.stringify(needle)}`, actual, reason: 'expected a string or array for $includes' });
    }
    return;
  }
  if (isGtMatcher(expected)) {
    const threshold = (expected as { $gt: number }).$gt;
    if (typeof actual !== 'number') {
      diffs.push({ path, expected: `$gt ${threshold}`, actual, reason: 'expected a number for $gt' });
    } else if (actual <= threshold) {
      diffs.push({ path, expected: `$gt ${threshold}`, actual, reason: `value ${actual} is not > ${threshold}` });
    }
    return;
  }
  if (isLtMatcher(expected)) {
    const threshold = (expected as { $lt: number }).$lt;
    if (typeof actual !== 'number') {
      diffs.push({ path, expected: `$lt ${threshold}`, actual, reason: 'expected a number for $lt' });
    } else if (actual >= threshold) {
      diffs.push({ path, expected: `$lt ${threshold}`, actual, reason: `value ${actual} is not < ${threshold}` });
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push({ path, expected, actual, reason: 'expected an array' });
      return;
    }
    if (expected.length !== actual.length) {
      diffs.push({ path, expected: expected.length, actual: actual.length, reason: 'array length differs' });
    }
    expected.forEach((entry, index) => deepDiff(entry, actual[index], `${path}[${index}]`, diffs));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      diffs.push({ path, expected, actual, reason: 'expected an object' });
      return;
    }
    for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
      const actualObj = actual as Record<string, unknown>;
      const has = Object.prototype.hasOwnProperty.call(actualObj, key);
      if (isAbsentMatcher(value)) {
        if (has) {
          diffs.push({ path: path === '' ? key : `${path}.${key}`, expected: '$absent', actual: actualObj[key], reason: 'unexpected field present' });
        }
        continue;
      }
      if (!has) {
        diffs.push({ path: path === '' ? key : `${path}.${key}`, expected: value, actual: undefined, reason: 'missing field' });
        continue;
      }
      deepDiff(value, actualObj[key], path === '' ? key : `${path}.${key}`, diffs);
    }
    return;
  }
  if (expected !== actual) {
    diffs.push({ path, expected, actual, reason: 'value differs' });
  }
}

function parseRedirect(location: string): { location: string; query: Record<string, string>; fragment: Record<string, string> } {
  const query: Record<string, string> = {};
  const fragment: Record<string, string> = {};
  const hash = location.indexOf('#');
  const withoutFragment = hash === -1 ? location : location.slice(0, hash);
  const fragmentString = hash === -1 ? '' : location.slice(hash + 1);
  const question = withoutFragment.indexOf('?');
  const queryString = question === -1 ? '' : withoutFragment.slice(question + 1);
  for (const [segment, target] of [
    [queryString, query],
    [fragmentString, fragment],
  ] as const) {
    for (const pair of segment.split('&')) {
      if (pair === '') continue;
      const eq = pair.indexOf('=');
      const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
      const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      target[key] = value;
    }
  }
  return { location, query, fragment };
}

export function compareResponse(expect: ScenarioExpectation, actual: ActualResponse, scope?: CaptureScope): Diff[] {
  const diffs: Diff[] = [];
  if (actual.status !== expect.status) {
    diffs.push({
      path: 'status',
      expected: expect.status,
      actual: actual.status,
      reason: 'HTTP status differs',
    });
  }
  for (const [name, value] of Object.entries(expect.headers ?? {})) {
    const expected = scope === undefined ? value : interpolate(value, scope);
    const found = headerValue(actual.headers, name);
    if (found === undefined) {
      diffs.push({ path: `headers.${name}`, expected, actual: undefined, reason: 'missing header' });
    } else if (found !== expected) {
      diffs.push({ path: `headers.${name}`, expected, actual: found, reason: 'header value differs' });
    }
  }

  if (expect.json !== undefined) {
    if (actual.body === undefined) {
      diffs.push({ path: 'body', expected: expect.json, actual: undefined, reason: 'expected a JSON body' });
    } else {
      deepDiff(normalizePayload(interpolateLeaves(expect.json, scope)), normalizePayload(actual.body), '', diffs);
    }
  }

  if (expect.redirect !== undefined) {
    const location = actual.redirect?.location ?? headerValue(actual.headers, 'location');
    if (location === undefined) {
      diffs.push({ path: 'redirect.location', expected: expect.redirect.location ?? '<any>', actual: undefined, reason: 'missing Location header' });
    } else {
      const parsed = actual.redirect ?? parseRedirect(location);
      if (expect.redirect.location !== undefined && parsed.location !== expect.redirect.location) {
        diffs.push({ path: 'redirect.location', expected: expect.redirect.location, actual: parsed.location, reason: 'redirect target differs' });
      }
      if (expect.redirect.locationPrefix !== undefined && !parsed.location.startsWith(expect.redirect.locationPrefix)) {
        diffs.push({ path: 'redirect.location', expected: `${expect.redirect.locationPrefix}*`, actual: parsed.location, reason: 'redirect target does not start with the expected prefix' });
      }
      for (const [key, value] of Object.entries(expect.redirect.query ?? {})) {
        const found = parsed.query[key];
        if (found === undefined) {
          diffs.push({ path: `redirect.query.${key}`, expected: value, actual: undefined, reason: 'missing query parameter' });
        } else if (found !== value) {
          diffs.push({ path: `redirect.query.${key}`, expected: value, actual: found, reason: 'query parameter differs' });
        }
      }
      for (const [key, value] of Object.entries(expect.redirect.fragment ?? {})) {
        const found = parsed.fragment[key];
        if (found === undefined) {
          diffs.push({ path: `redirect.fragment.${key}`, expected: value, actual: undefined, reason: 'missing fragment parameter' });
        } else if (found !== value) {
          diffs.push({ path: `redirect.fragment.${key}`, expected: value, actual: found, reason: 'fragment parameter differs' });
        }
      }
    }
  }

  return diffs;
}

/**
 * Extract a captured value from a response using `body.x`, `header.x`,
 * `redirect.query.x`, or `jwt.<var>.<header|payload>.<field>` (decode the JWT
 * held in an earlier-captured variable and read a header/payload field).
 */
export function captureValue(expression: string, actual: ActualResponse, scope?: CaptureScope): string | undefined {
  const dot = expression.indexOf('.');
  const scope_ = expression.slice(0, dot);
  const rest = expression.slice(dot + 1);
  if (scope_ === 'jwt') {
    // jwt.<sourceVar>.<header|payload>.<field>
    const sourceDot = rest.indexOf('.');
    if (sourceDot === -1 || scope === undefined) return undefined;
    const source = rest.slice(0, sourceDot);
    const partAndField = rest.slice(sourceDot + 1);
    const partDot = partAndField.indexOf('.');
    if (partDot === -1) return undefined;
    const part = partAndField.slice(0, partDot);
    const field = partAndField.slice(partDot + 1);
    if (part !== 'header' && part !== 'payload') return undefined;
    const token = scope.get(source);
    if (token === undefined) return undefined;
    try {
      const segments = decodeJwtSegments(token);
      const value = fieldAt(part === 'header' ? segments.header : segments.payload, field);
      if (value === undefined || value === null) return undefined;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (typeof value === 'string') return value;
      // Arrays and objects: JSON-stringify so the capture holds the whole value.
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  if (scope_ === 'header') return headerValue(actual.headers, rest);
  if (scope_ === 'redirect') {
    const redirect = actual.redirect ?? (headerValue(actual.headers, 'location') !== undefined ? parseRedirect(headerValue(actual.headers, 'location') as string) : undefined);
    if (redirect === undefined) return undefined;
    const segment = rest.startsWith('query.') ? redirect.query : rest.startsWith('fragment.') ? redirect.fragment : undefined;
    if (segment === undefined) return undefined;
    const key = rest.slice(rest.indexOf('.') + 1);
    return segment[key];
  }
  if (scope_ === 'body') {
    if (actual.body === null || typeof actual.body !== 'object') return undefined;
    let current: unknown = actual.body;
    for (const segment of rest.split('.')) {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    if (typeof current === 'string') return current;
    if (typeof current === 'number' || typeof current === 'boolean') return String(current);
    return undefined;
  }
  return undefined;
}

export { parseRedirect };

/**
 * Resolve an assertion body against the capture scope.
 *
 * For assert steps, string values in `expect.json` are `{{var}}` references
 * that must be resolved against the scope and parsed as JSON when they look
 * like JSON arrays/objects/numbers. This produces a plain object that
 * compareResponse can work with without needing a live HTTP response.
 */
export function resolveAssertionBody(
  json: Record<string, unknown> | undefined,
  scope: CaptureScope,
): Record<string, unknown> | undefined {
  if (json === undefined) return undefined;
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string' && value.includes('{{')) {
      const interpolated = interpolate(value, scope);
      // Try to parse as JSON if it looks like an array or object
      const trimmed = interpolated.trimStart();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          resolved[key] = JSON.parse(interpolated);
          continue;
        } catch {
          // fall through to string
        }
      }
      // Try to parse as number
      const num = Number(interpolated);
      if (!Number.isNaN(num) && String(num) === interpolated) {
        resolved[key] = num;
        continue;
      }
      resolved[key] = interpolated;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
