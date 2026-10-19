/**
 * Declarative matchers used inside `expect.json` values.
 *
 * `expect.json` is otherwise an exact shape: undeclared fields are ignored and
 * declared fields must deep-equal after normalization. A small set of $prefixed
 * matcher object nodes relax that where an RFC needs a non-exact assertion:
 *
 *   - `{ "$contains": value }`    the actual array must contain `value`;
 *   - `{ "$nonempty": true }`     the actual array must contain at least one entry;
 *   - `{ "$absent": true }`       this member must NOT be present in the actual
 *                                 object (asserts absence, opposite of the default
 *                                 "must be present").
 *   - `{ "$includes": value }`    the actual string or array must include `value`
 *                                 as a substring / member; on a string this is a
 *                                 substring check; on an array this is the same
 *                                 as `$contains`.
 *   - `{ "$gt": value }`          the actual numeric value must be strictly
 *                                 greater than `value`.
 *   - `{ "$lt": value }`          the actual numeric value must be strictly
 *                                 less than `value`.
 *
 * Only these forms are recognized. Any other object is treated as a
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

/** True when `value` is a `{ "$includes": X }` matcher, for any X. */
export function isIncludesMatcher(value: unknown): boolean {
  return matcherKey(value) === '$includes';
}

/** True when `value` is a `{ "$gt": X }` matcher, for any numeric X. */
export function isGtMatcher(value: unknown): boolean {
  const key = matcherKey(value);
  if (key !== '$gt') return false;
  return typeof (value as Record<string, unknown>).$gt === 'number';
}

/** True when `value` is a `{ "$lt": X }` matcher, for any numeric X. */
export function isLtMatcher(value: unknown): boolean {
  const key = matcherKey(value);
  if (key !== '$lt') return false;
  return typeof (value as Record<string, unknown>).$lt === 'number';
}
