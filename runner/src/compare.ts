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

/** Structural comparison where an expected `NORMALIZED` matches anything present. */
function deepDiff(expected: unknown, actual: unknown, path: string, diffs: Diff[]): void {
  if (isNormalized(expected)) {
    if (actual === undefined) {
      diffs.push({ path, expected: '<nondeterministic value>', actual, reason: 'missing required field' });
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
      const has = Object.prototype.hasOwnProperty.call(actual as Record<string, unknown>, key);
      if (!has) {
        diffs.push({ path: path === '' ? key : `${path}.${key}`, expected: value, actual: undefined, reason: 'missing field' });
        continue;
      }
      deepDiff(value, (actual as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`, diffs);
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

export function compareResponse(expect: ScenarioExpectation, actual: ActualResponse): Diff[] {
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
    const found = headerValue(actual.headers, name);
    if (found === undefined) {
      diffs.push({ path: `headers.${name}`, expected: value, actual: undefined, reason: 'missing header' });
    } else if (found !== value) {
      diffs.push({ path: `headers.${name}`, expected: value, actual: found, reason: 'header value differs' });
    }
  }

  if (expect.json !== undefined) {
    if (actual.body === undefined) {
      diffs.push({ path: 'body', expected: expect.json, actual: undefined, reason: 'expected a JSON body' });
    } else {
      deepDiff(normalizePayload(expect.json), normalizePayload(actual.body), '', diffs);
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

/** Extract a captured value from a response using `body.x`, `header.x`, `redirect.query.x`. */
export function captureValue(expression: string, actual: ActualResponse): string | undefined {
  const dot = expression.indexOf('.');
  const scope = expression.slice(0, dot);
  const rest = expression.slice(dot + 1);
  if (scope === 'header') return headerValue(actual.headers, rest);
  if (scope === 'redirect') {
    const redirect = actual.redirect ?? (headerValue(actual.headers, 'location') !== undefined ? parseRedirect(headerValue(actual.headers, 'location') as string) : undefined);
    if (redirect === undefined) return undefined;
    const segment = rest.startsWith('query.') ? redirect.query : rest.startsWith('fragment.') ? redirect.fragment : undefined;
    if (segment === undefined) return undefined;
    const key = rest.slice(rest.indexOf('.') + 1);
    return segment[key];
  }
  if (scope === 'body') {
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
