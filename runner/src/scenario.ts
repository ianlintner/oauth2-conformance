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

export interface ScenarioRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  /** Application/x-www-form-urlencoded body. */
  form?: Record<string, string>;
  /** JSON body. Mutually exclusive with `form`. */
  json?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ScenarioExpectation {
  status: number;
  headers?: Record<string, string>;
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

export interface ScenarioStep {
  id: string;
  /** Runner helper invoked instead of a raw request (e.g. `login-and-authorize`). */
  use?: string;
  with?: Record<string, unknown>;
  request?: ScenarioRequest;
  expect?: ScenarioExpectation;
  capture?: Record<string, string>;
}

export interface Scenario {
  id: string;
  title?: string;
  requirements: string[];
  profile: string;
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
    ...(request.query !== undefined ? { query: strings(request.query, `${label}.query`) } : {}),
    ...(request.form !== undefined ? { form: strings(request.form, `${label}.form`) } : {}),
    ...(request.json !== undefined ? { json: record(request.json, `${label}.json`) } : {}),
    ...(request.headers !== undefined ? { headers: strings(request.headers, `${label}.headers`) } : {}),
  };
}

export function parseExpectation(input: unknown, label: string): ScenarioExpectation {
  const expect = record(input, label);
  if (!Number.isInteger(expect.status) || (expect.status as number) < 100 || (expect.status as number) > 599) {
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
    status: expect.status as number,
    ...(expect.headers !== undefined ? { headers: strings(expect.headers, `${label}.headers`) } : {}),
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

function parseStep(input: unknown, index: number): ScenarioStep {
  const label = `steps[${index}]`;
  const step = record(input, label);
  const id = stringAt(step.id, `${label}.id`);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new TypeError(`${label}.id must be an identifier`);

  if (step.use !== undefined) {
    if (step.request !== undefined) throw new TypeError(`${label} cannot carry both use and request`);
    return {
      id,
      use: stringAt(step.use, `${label}.use`),
      ...(step.with !== undefined ? { with: record(step.with, `${label}.with`) } : {}),
      ...(step.expect !== undefined ? { expect: parseExpectation(step.expect, `${label}.expect`) } : {}),
      ...(step.capture !== undefined ? { capture: parseCapture(step.capture, `${label}.capture`) } : {}),
    };
  }
  if (step.request === undefined) throw new TypeError(`${label} requires either use or request`);
  if (step.expect === undefined) throw new TypeError(`${label} with a request requires expect`);
  return {
    id,
    request: parseRequest(step.request, `${label}.request`),
    expect: parseExpectation(step.expect, `${label}.expect`),
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
    status,
    ...(value.note !== undefined ? { note: value.note as string } : {}),
    steps: value.steps.map((step, index) => parseStep(step, index)),
  };
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
