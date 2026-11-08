/**
 * Structural parsing of conformance scenarios.
 *
 * The scenario format evolves the typescript-oauth2-server fixture format
 * (`request`/`expect`/`bind`, @d1999bf) into ordered steps with captures and
 * `{{var}}` interpolation. This module mirrors the defensive, fail-fast
 * parsing style of the original `fixture.ts`: every malformed file throws with
 * a field-scoped message at load time rather than producing an opaque runtime
 * mismatch mid-run.
 *
 * JSON Schema validation (schemas/scenario.schema.json) is the primary gate for
 * published data files; this parser is the runner's own independent check so
 * the runner never trusts a schema an operator may not have run.
 */

import { parseHttpMethod, parseScenarioStatus, type HttpMethod, type ScenarioStatus } from './status.js';

/** One ordered form/query field, so a parameter may be sent more than once. */
export interface NameValuePair {
  name: string;
  value: string;
}

/** `form`/`query` are either a string map or an ordered list of pairs. */
export type FormFields = Record<string, string> | NameValuePair[];

export interface ScenarioRequest {
  method: HttpMethod;
  path: string;
  query?: FormFields;
  /** Application/x-www-form-urlencoded body. */
  form?: FormFields;
  /** JSON body. Mutually exclusive with `form`. */
  json?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** A response-header assertion: an exact value, or a matcher object. */
export type HeaderExpectation = string | { $nonempty?: boolean; $regex?: string };

export interface ScenarioExpectation {
  status?: number;
  headers?: Record<string, HeaderExpectation>;
  /** Declared top-level claims must be present and match normalized values. */
  json?: Record<string, unknown>;
  /** Inline JSON Schema the normalized body must satisfy. */
  jsonSchema?: Record<string, unknown>;
  redirect?: {
    location?: string;
    /** Redirect Location must start with this literal prefix (e.g. scheme://host:port/path?). */
    locationPrefix?: string;
    query?: Record<string, string>;
    fragment?: Record<string, string>;
  };
}

/** Upper bound on a step's `repeat` count, so a scenario cannot loop unbounded. */
export const MAX_REPEAT = 100;

export interface ScenarioStep {
  id: string;
  /** Bounded replay: run the request (and assert `expect`) this many times. */
  repeat?: number;
  /** Runner helper invoked instead of a raw request (e.g. `login-and-authorize`). */
  use?: string;
  with?: Record<string, unknown>;
  request?: ScenarioRequest;
  expect?: ScenarioExpectation;
  capture?: Record<string, string>;
  /** Post-capture assertion: carries an `expect` block that runs against
   *  the capture scope rather than a fresh HTTP response. String values
   *  in the expect block resolve `{{var}}` references and parse as JSON
   *  when they look parseable. When `source` is set to `jwt.<var>.payload`,
   *  the JWT stored in scope variable `<var>` is decoded and its payload
   *  becomes the assertion body. */
  assert?: ScenarioExpectation;
  /** Source for the assert step's actual body. `jwt.<var>.payload` decodes
   *  the JWT at scope variable `<var>` and uses its payload. Default:
   *  build from scope keys. */
  source?: string;
}

export interface Scenario {
  id: string;
  title?: string;
  requirements: string[];
  profile: string;
  /** Additional profiles this scenario is explicitly compatible with (opt-in). */
  profiles?: string[];
  status: ScenarioStatus;
  note?: string;
  steps: ScenarioStep[];
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VAR_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\}\}/g;

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function stringAt(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function strings(input: unknown, label: string): Record<string, string> {
  const value = record(input, label);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new TypeError(`${label}.${key} must be a string`);
  }
  return value as Record<string, string>;
}

/** Return `input` as a string, string-type-only (an empty string stays valid). */
function stringLiteral(input: unknown, label: string): string {
  if (typeof input !== 'string') throw new TypeError(`${label} must be a string`);
  return input;
}

/** True when `pattern` is a syntactically valid regular expression. */
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function stringList(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new TypeError(`${label} must be a nonempty array`);
  return input.map((entry, index) => stringAt(entry, `${label}[${index}]`));
}

/** Parse `form`/`query`: a string map or an ordered list of { name, value }. */
export function parseFormFields(input: unknown, label: string): Record<string, string> | NameValuePair[] {
  if (Array.isArray(input)) {
    if (input.length === 0) throw new TypeError(`${label} must be a nonempty array when given as a list`);
    return input.map((entry, index) => {
      const pair = record(entry, `${label}[${index}]`);
      if (typeof pair.name !== 'string' || pair.name === '' || typeof pair.value !== 'string') {
        throw new TypeError(`${label}[${index}] must be an object with nonempty string name and value`);
      }
      return { name: pair.name, value: pair.value };
    });
  }
  return strings(input, label);
}

/** Reject a path that can leave the configured server origin. */
export function parsePath(input: unknown, label: string): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.includes('\\')) {
    throw new TypeError(`${label} path must start with / and be local to the server`);
  }
  return input;
}

export function parseRequest(input: unknown, label: string): ScenarioRequest {
  const request = record(input, label);
  const method = parseHttpMethod(request.method);
  const path = parsePath(request.path, label);
  if (request.form !== undefined && request.json !== undefined) {
    throw new TypeError(`${label} cannot carry both form and json bodies`);
  }
  return {
    method,
    path,
    ...(request.query !== undefined ? { query: parseFormFields(request.query, `${label}.query`) } : {}),
    ...(request.form !== undefined ? { form: parseFormFields(request.form, `${label}.form`) } : {}),
    ...(request.json !== undefined ? { json: record(request.json, `${label}.json`) } : {}),
    ...(request.headers !== undefined ? { headers: strings(request.headers, `${label}.headers`) } : {}),
  };
}

/** Parse `expect.headers`: exact strings or `{ $nonempty }` / `{ $regex }` matchers. */
function parseHeaderExpectations(input: unknown, label: string): Record<string, HeaderExpectation> {
  const headers = record(input, label);
  // Null-prototype so a header named `__proto__` (allowed by the schema) is an
  // own enumerable assertion rather than hitting the inherited setter and
  // silently vanishing from the comparison.
  const out = Object.create(null) as Record<string, HeaderExpectation>;
  for (const [name, raw] of Object.entries(headers)) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const matcher = raw as Record<string, unknown>;
      const keys = Object.keys(matcher);
      if (keys.length === 1 && keys[0] === '$nonempty' && matcher.$nonempty === true) {
        out[name] = { $nonempty: true };
        continue;
      }
      if (keys.length === 1 && keys[0] === '$regex' && typeof matcher.$regex === 'string' && matcher.$regex.length > 0) {
        if (!isValidRegex(matcher.$regex)) {
          throw new TypeError(`${label}.headers.${name} has an invalid $regex pattern`);
        }
        out[name] = { $regex: matcher.$regex };
        continue;
      }
      throw new TypeError(`${label}.headers.${name} must be a string or a { $nonempty: true } / { $regex: "..." } matcher`);
    }
    out[name] = stringLiteral(raw, `${label}.headers.${name}`);
  }
  return out;
}

export function parseExpectation(input: unknown, label: string): ScenarioExpectation {
  const expect = record(input, label);
  const hasStatus = expect.status !== undefined;
  if (hasStatus && (!Number.isInteger(expect.status) || (expect.status as number) < 100 || (expect.status as number) > 599)) {
    throw new TypeError(`${label}: expected status must be an HTTP status code`);
  }
  let redirect: ScenarioExpectation['redirect'];
  if (expect.redirect !== undefined) {
    const raw = record(expect.redirect, `${label}.redirect`);
    redirect = {
      ...(raw.location !== undefined ? { location: stringAt(raw.location, `${label}.redirect.location`) } : {}),
      ...(raw.locationPrefix !== undefined ? { locationPrefix: stringAt(raw.locationPrefix, `${label}.redirect.locationPrefix`) } : {}),
      ...(raw.query !== undefined ? { query: strings(raw.query, `${label}.redirect.query`) } : {}),
      ...(raw.fragment !== undefined ? { fragment: strings(raw.fragment, `${label}.redirect.fragment`) } : {}),
    };
  }
  return {
    ...(hasStatus ? { status: expect.status as number } : {}),
    ...(expect.headers !== undefined ? { headers: parseHeaderExpectations(expect.headers, `${label}.headers`) } : {}),
    ...(expect.json !== undefined ? { json: record(expect.json, `${label}.json`) } : {}),
    ...(expect.jsonSchema !== undefined ? { jsonSchema: record(expect.jsonSchema, `${label}.jsonSchema`) } : {}),
    ...(redirect !== undefined ? { redirect } : {}),
  };
}

function parseCapture(input: unknown, label: string): Record<string, string> {
  const capture = strings(input, label);
  for (const [name, expression] of Object.entries(capture)) {
    if (!ID_PATTERN.test(name)) throw new TypeError(`${label} requires valid variable names, got ${name}`);
    if (!/^(?:redirect\.(?:query|fragment)|body|header|jwt\.[A-Za-z_][A-Za-z0-9_]*\.(?:header|payload))\.[^\s]+$/.test(expression)) {
      throw new TypeError(`${label}.${name} must select redirect.query.*, redirect.fragment.*, body.*, header.* or jwt.<var>.<header|payload>.*`);
    }
  }
  return capture;
}

/** Parse a step-level `repeat` (`{ count: N }`), bounded by MAX_REPEAT. */
function parseRepeat(input: unknown, label: string): number {
  const rep = record(input, `${label}.repeat`);
  const count = rep.count;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_REPEAT) {
    throw new TypeError(`${label}.repeat.count must be an integer between 1 and ${MAX_REPEAT}`);
  }
  return count as number;
}

function parseStep(input: unknown, index: number): ScenarioStep {
  const label = `steps[${index}]`;
  const step = record(input, label);
  const id = stringAt(step.id, `${label}.id`);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new TypeError(`${label}.id must be an identifier`);

  if (step.use !== undefined) {
    if (step.request !== undefined) throw new TypeError(`${label} cannot carry both use and request`);
    if (step.assert !== undefined) throw new TypeError(`${label} cannot carry both use and assert`);
    if (step.repeat !== undefined) throw new TypeError(`${label} cannot carry repeat on a use step`);
    return {
      id,
      use: stringAt(step.use, `${label}.use`),
      ...(step.with !== undefined ? { with: record(step.with, `${label}.with`) } : {}),
      ...(step.expect !== undefined ? { expect: parseExpectation(step.expect, `${label}.expect`) } : {}),
      ...(step.capture !== undefined ? { capture: parseCapture(step.capture, `${label}.capture`) } : {}),
      ...(step.assert !== undefined ? { assert: parseExpectation(step.assert, `${label}.assert`) } : {}),
      ...(step.source !== undefined ? { source: stringAt(step.source, `${label}.source`) } : {}),
    };
  }
  if (step.assert !== undefined) {
    // Assert-only step: no HTTP request, runs against capture scope.
    if (step.repeat !== undefined) throw new TypeError(`${label} cannot carry repeat on an assert step`);
    return {
      id,
      assert: parseExpectation(step.assert, `${label}.assert`),
      ...(step.source !== undefined ? { source: stringAt(step.source, `${label}.source`) } : {}),
    };
  }
  if (step.request === undefined) throw new TypeError(`${label} requires use, assert, or request`);
  if (step.expect === undefined) throw new TypeError(`${label} with a request requires expect`);
  return {
    id,
    request: parseRequest(step.request, `${label}.request`),
    expect: parseExpectation(step.expect, `${label}.expect`),
    ...(step.repeat !== undefined ? { repeat: parseRepeat(step.repeat, label) } : {}),
    ...(step.capture !== undefined ? { capture: parseCapture(step.capture, `${label}.capture`) } : {}),
  };
}

export function parseScenario(input: unknown): Scenario {
  const value = record(input, 'scenario');
  const id = stringAt(value.id, 'scenario.id');
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(id)) {
    throw new TypeError(`scenario.id must be a dot-delimited lowercase identifier, got ${id}`);
  }
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    throw new TypeError('scenario.requirements must be a nonempty array');
  }
  const requirements = value.requirements.map((entry, index) => stringAt(entry, `scenario.requirements[${index}]`));
  const status = parseScenarioStatus(value.status);
  if (value.note !== undefined) stringAt(value.note, 'scenario.note');
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new TypeError('scenario.steps must be a nonempty array');
  }
  return {
    id,
    ...(value.title !== undefined ? { title: stringAt(value.title, 'scenario.title') } : {}),
    requirements,
    profile: stringAt(value.profile, 'scenario.profile'),
    ...(value.profiles !== undefined ? { profiles: stringList(value.profiles, 'scenario.profiles') } : {}),
    status,
    ...(value.note !== undefined ? { note: value.note as string } : {}),
    steps: value.steps.map((step, index) => parseStep(step, index)),
  };
}

/** Iterate `form`/`query` fields in order, preserving duplicate keys. */
export function formEntries(fields: FormFields | undefined): NameValuePair[] {
  if (fields === undefined) return [];
  if (Array.isArray(fields)) return fields;
  return Object.entries(fields).map(([name, value]) => ({ name, value }));
}

/** Resolve `{{name}}` (and `{{a.b}}`) references against a capture scope. */
export function interpolate(value: string, scope: { get(name: string): string | undefined }, onMissing?: (name: string) => string): string {
  return value.replace(VAR_PATTERN, (_match, name: string) => {
    const found = scope.get(name);
    if (found !== undefined) return found;
    if (onMissing) return onMissing(name);
    throw new Error(`unbound variable ${name}`);
  });
}

export function interpolateRecord(
  record: Record<string, string>,
  scope: Map<string, string>,
  onMissing?: (name: string) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, interpolate(value, scope, onMissing)]));
}
