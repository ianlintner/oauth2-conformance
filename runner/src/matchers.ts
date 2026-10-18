/**
 * Declarative matchers used inside `expect.json` values.
 *
 * `expect.json` is otherwise an exact shape: undeclared fields are ignored and
 * declared fields must deep-equal after normalization. A small set of $prefixed
 * matcher object nodes relax that where an RFC needs a non-exact assertion:
 *
 *   - `{ "$contains": value }`  the actual array must contain `value`;
 *   - `{ "$nonempty": true }`   the actual array must contain at least one entry;
 *   - `{ "$absent": true }`     this member must NOT be present in the actual
 *                               object (asserts absence, opposite of the default
 *                               "must be present").
 *
 * Only these three forms are recognized. Any other object is treated as a
 * literal object, so a real JSON member named `$contains` is unreachable in
 * expectation data — acceptable, because OAuth2 responses never carry such
 * keys.
 */

/** Sole key of a matcher object, or undefined when the object is not a matcher. */
export function matcherKey(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length !== 1) return undefined;
  const key = keys[0]!;
  return key.startsWith('$') ? key : undefined;
}

/** True when `value` is exactly `{ "$absent": true }`. */
export function isAbsentMatcher(value: unknown): boolean {
  return matcherKey(value) === '$absent' && (value as Record<string, unknown>).$absent === true;
}

/** True when `value` is exactly `{ "$nonempty": true }`. */
export function isNonemptyMatcher(value: unknown): boolean {
  return matcherKey(value) === '$nonempty' && (value as Record<string, unknown>).$nonempty === true;
}

/** True when `value` is a `{ "$contains": X }` matcher, for any X. */
export function isContainsMatcher(value: unknown): boolean {
  return matcherKey(value) === '$contains';
}
