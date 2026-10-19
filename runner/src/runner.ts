/**
 * Scenario execution engine.
 *
 * Ported from typescript-oauth2-server `src/conformance/runner.ts` (@d1999bf)
 * with the same reporting shape (per-scenario outcome plus structured diffs),
 * generalized to:
 *  - black-box HTTP execution against a base URL (see ./http.ts);
 *  - ordered multi-step scenarios with `{{var}}` captures;
 *  - `draft` and `reference-deviation` scenarios: they still execute (so one
 *    that starts passing is visible) but a failure is recorded as `deferred`
 *    rather than `fail`, and only `stable` scenarios affect the verdict.
 *
 * A run in which no stable scenario executed must never report `pass`: an
 * empty run is not conformance evidence.
 */

import { compareResponse, captureValue, type Diff } from './compare.js';
import { interpolate, interpolateRecord, type Scenario, type ScenarioStep } from './scenario.js';
import { encodeForm, resolveUrl, sendRequest, type TransportOptions } from './http.js';
import { decodeJwtSegments } from './jwt.js';

export interface ScenarioResult {
  id: string;
  title?: string;
  profile: string;
  status: Scenario['status'];
  requirements: string[];
  outcome: 'pass' | 'fail' | 'deferred';
  diffs: Diff[];
  note?: string;
  steps: number;
  error?: string;
}

export interface RunReport {
  contract: string;
  implementation: string;
  profile: string;
  startedAt: string;
  finishedAt: string;
  executed: number;
  passed: number;
  failed: number;
  deferred: number;
  verdict: 'pass' | 'fail';
  results: ScenarioResult[];
}

export interface RunOptions extends TransportOptions {
  baseUrl: string;
  implementation: string;
  contract: string;
  /** Only run scenarios in this profile. */
  profile?: string;
  /** Only run scenarios whose requirements intersect this list. */
  only?: string[];
  /** Run helpers keyed by `use` name. */
  helpers?: Record<string, ScenarioHelper>;
}

export interface HelperContext {
  send(request: { method: string; url: string; headers: Record<string, string>; body?: string }): Promise<import('./compare.js').ActualResponse>;
  scope: Map<string, string>;
  with: Record<string, unknown>;
  /** Run-wide login sessions (loginPath\0username\0password -> cookie), shared by every scenario in one run. */
  sessions?: Map<string, string>;
}

export type ScenarioHelper = (context: HelperContext) => Promise<import('./compare.js').ActualResponse>;

export function selectScenarios(scenarios: Scenario[], options: RunOptions): Scenario[] {
  return scenarios.filter((scenario) => {
    if (scenario.status === 'retired') return false;
    if (options.profile !== undefined && scenario.profile !== options.profile) return false;
    if (options.only !== undefined && options.only.length > 0) {
      return scenario.requirements.some((requirement) => options.only?.includes(requirement));
    }
    return true;
  });
}

/** Resolve a request body/headers/query, failing on unbound variables. */
function buildRequest(
  step: ScenarioStep,
  scope: Map<string, string>,
): { method: string; url: string; headers: Record<string, string>; body?: string } {
  if (step.request === undefined) throw new Error(`step ${step.id} has no request`);
  const request = step.request;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    headers[key] = interpolate(value, scope);
  }
  const url = new URL(resolveUrl('http://placeholder.invalid', request.path));
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.append(key, interpolate(value, scope));
  }
  const request_ = {
    method: request.method,
    path: `${url.pathname}${url.search}`,
  };
  return { method: request_.method, url: request_.path, headers };
}

export async function runScenarios(scenarios: Scenario[], options: RunOptions): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const selected = selectScenarios(scenarios, options);
  const results: ScenarioResult[] = [];
  const sessions = new Map<string, string>();

  for (const scenario of selected) {
    const scope = new Map<string, string>();
    const diffs: Diff[] = [];
    let steps = 0;
    let error: string | undefined;

    for (const step of scenario.steps) {
      try {
        let actual: import('./compare.js').ActualResponse;
        if (step.use !== undefined) {
          const helper = options.helpers?.[step.use];
          if (helper === undefined) throw new Error(`unknown step helper: ${step.use}`);
          actual = await helper({
            send: (request) =>
              sendRequest(
                { ...request, url: resolveUrl(options.baseUrl, request.url) },
                options,
              ),
            scope,
            with: step.with ?? {},
            sessions,
          });
        } else {
          const request = buildRequest(step, scope);
          const headers = { ...request.headers };
          let body: string | undefined;
          if (step.request?.form !== undefined) {
            body = encodeForm(interpolateRecord(step.request.form, scope));
            headers['content-type'] ??= 'application/x-www-form-urlencoded';
          } else if (step.request?.json !== undefined) {
            body = JSON.stringify(
              JSON.parse(interpolate(JSON.stringify(step.request.json), scope)) as unknown,
            );
            headers['content-type'] ??= 'application/json';
          }
          actual = await sendRequest(
            {
              method: request.method,
              url: resolveUrl(options.baseUrl, request.url),
              headers,
              ...(body !== undefined ? { body } : {}),
            },
            options,
          );
        }
        steps += 1;

        if (step.expect !== undefined) {
          diffs.push(...compareResponse(step.expect, actual, scope).map((diff) => ({ ...diff, path: `${step.id}.${diff.path}` })));
        }
        for (const [name, expression] of Object.entries(step.capture ?? {})) {
          const value = captureValue(expression, actual, scope);
          if (value === undefined) {
            diffs.push({ path: `${step.id}.capture.${name}`, expected: expression, actual: undefined, reason: 'capture expression found no value' });
          } else {
            scope.set(name, value);
          }
        }
        if (step.assert !== undefined) {
          const assertExpect = step.assert;
          let actualBody: Record<string, unknown> = {};

          // Resolve source: if `jwt.<var>.payload`, decode the JWT's payload.
          const source = step.source ?? '';
          if (source.startsWith('jwt.')) {
            const parts = source.split('.');
            if (parts.length >= 3 && parts[2] === 'payload') {
              const varName = parts[1]!;
              const token = scope.get(varName);
              if (token !== undefined) {
                try {
                  actualBody = decodeJwtSegments(token).payload as Record<string, unknown>;
                } catch {
                  diffs.push({
                    path: `${step.id}.source`,
                    expected: `jwt.${varName}.payload`,
                    actual: undefined,
                    reason: `failed to decode JWT from ${varName}`,
                  });
                }
              } else {
                diffs.push({
                  path: `${step.id}.source`,
                  expected: `jwt.${varName}.payload`,
                  actual: undefined,
                  reason: `variable ${varName} not in scope`,
                });
              }
            }
          } else {
            // Build actual from scope keys; parse JSON/numbers.
            for (const [key] of Object.entries(assertExpect.json ?? {})) {
              const raw = scope.get(key);
              if (raw !== undefined) {
                const trimmed = raw.trimStart();
                if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                  try { actualBody[key] = JSON.parse(raw); } catch { actualBody[key] = raw; }
                } else {
                  const num = Number(raw);
                  actualBody[key] = (!Number.isNaN(num) && String(num) === raw) ? num : raw;
                }
              }
            }
          }

          const resolvedExpect: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(assertExpect.json ?? {})) {
            resolvedExpect[key] = typeof value === 'string'
              ? interpolate(value, scope, () => '')
              : value;
          }
          const expectWithResolved = {
            ...assertExpect,
            json: resolvedExpect,
          };
          const fakeResponse: import('./compare.js').ActualResponse = {
            status: 200,
            headers: {},
            body: actualBody,
          };
          diffs.push(
            ...compareResponse(expectWithResolved, fakeResponse, scope).map((diff) => ({
              ...diff,
              path: `${step.id}.${diff.path}`,
            })),
          );
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        diffs.push({ path: step.id, expected: '<step completes>', actual: undefined, reason: `step threw: ${error}` });
        break;
      }
    }

    const rawOutcome: ScenarioResult['outcome'] = diffs.length === 0 ? 'pass' : 'fail';
    // Only `stable` scenarios can fail the build. A failing `draft` or
    // `reference-deviation` scenario is still reported, as `deferred`.
    const outcome = rawOutcome === 'fail' && scenario.status !== 'stable' ? 'deferred' : rawOutcome;
    results.push({
      id: scenario.id,
      ...(scenario.title !== undefined ? { title: scenario.title } : {}),
      profile: scenario.profile,
      status: scenario.status,
      requirements: scenario.requirements,
      outcome,
      diffs,
      ...(scenario.note !== undefined ? { note: scenario.note } : {}),
      steps,
      ...(error !== undefined ? { error } : {}),
    });
  }

  const executed = results.length;
  const passed = results.filter((result) => result.outcome === 'pass').length;
  const failed = results.filter((result) => result.outcome === 'fail').length;
  const deferred = results.filter((result) => result.outcome === 'deferred').length;

  // A run in which no stable scenario executed is not evidence of conformance.
  const stableExecuted = results.filter((result) => result.status === 'stable').length;

  return {
    contract: options.contract,
    implementation: options.implementation,
    profile: options.profile ?? '*',
    startedAt,
    finishedAt: new Date().toISOString(),
    executed,
    passed,
    failed,
    deferred,
    verdict: failed === 0 && stableExecuted > 0 ? 'pass' : 'fail',
    results,
  };
}
