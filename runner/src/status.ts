/**
 * Conformance status vocabulary, shared by scenarios, profiles and reports.
 *
 * Extracted from typescript-oauth2-server `src/conformance/status.ts`
 * (@d1999bf) and extended for the language-neutral contract, where scenarios
 * carry a lifecycle (`draft` | `stable` | `reference-deviation` | `retired`)
 * rather than a TypeScript porting status.
 */

/** Scenario lifecycle. Only `stable` scenarios count toward conformance. */
export type ScenarioStatus = 'draft' | 'stable' | 'reference-deviation' | 'retired';

export const SCENARIO_STATUSES: readonly ScenarioStatus[] = [
  'draft',
  'stable',
  'reference-deviation',
  'retired',
] as const;

/** The supported HTTP methods for a conformance scenario request. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'] as const;

/** Outcome of a single scenario in a run. */
export type Outcome = 'pass' | 'fail' | 'deferred';

export function parseScenarioStatus(input: unknown): ScenarioStatus {
  if (typeof input === 'string' && (SCENARIO_STATUSES as readonly string[]).includes(input)) {
    return input as ScenarioStatus;
  }
  throw new TypeError(`unknown scenario status: ${String(input)}`);
}

export function parseHttpMethod(input: unknown): HttpMethod {
  if (typeof input === 'string' && (HTTP_METHODS as readonly string[]).includes(input)) {
    return input as HttpMethod;
  }
  throw new TypeError(`unknown HTTP method: ${String(input)}`);
}
