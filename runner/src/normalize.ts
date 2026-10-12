/**
 * Normalization of inherently nondeterministic values before comparison.
 *
 * Extracted verbatim in semantics from typescript-oauth2-server
 * `src/conformance/normalize.ts` (@d1999bf). Only explicitly named token and
 * timestamp fields are normalized; an unnamed string carries no evidence of
 * nondeterminism and is preserved.
 */

/** Values that are inherently nondeterministic and must be normalized away. */
export const TOKEN_FIELDS = [
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'request_uri',
  'device_code',
  'user_code',
  'registration_access_token',
  'jti',
] as const;

/** RFC 7519 NumericDate claims that drift between runs. */
export const TIME_CLAIMS = ['exp', 'iat', 'nbf', 'auth_time'] as const;

/** Internal marker not representable by a JSON response, preventing collisions. */
export const NORMALIZED = Symbol('normalized');

/** Without a field name, strings carry no evidence of nondeterminism. */
export function normalizeValue(value: string): string {
  return value;
}

/** Normalize only explicitly named token and timestamp fields. */
export function normalizePayload(value: unknown, depth = 0): unknown {
  if (depth > 32) {
    throw new RangeError('response nesting exceeds depth 32');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePayload(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      let normalized: unknown;
      if ((TOKEN_FIELDS as readonly string[]).includes(key)) {
        normalized = typeof entry === 'string' && entry.length > 0 ? NORMALIZED : normalizePayload(entry, depth + 1);
      } else if ((TIME_CLAIMS as readonly string[]).includes(key)) {
        normalized = typeof entry === 'number' && Number.isFinite(entry) ? NORMALIZED : normalizePayload(entry, depth + 1);
      } else {
        normalized = normalizePayload(entry, depth + 1);
      }
      // Assignment to __proto__ would change the result's prototype and drop
      // a real JSON claim. Define every key as an own property instead.
      Object.defineProperty(out, key, { value: normalized, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  if (typeof value === 'string') {
    return normalizeValue(value);
  }
  return value;
}
