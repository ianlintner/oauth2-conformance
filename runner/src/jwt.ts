/**
 * JWT decode for the `jwt.<source>.<header|payload>.<field>` capture expression.
 *
 * The runner never verifies signatures here — signature verification is a
 * scenario-level concern (see `token-lifecycle.jwt.verifiable-with-jwks`) that
 * needs the SUT's JWKS and clock, which live outside the capture step. This
 * module only base64url-decodes the header and payload segments so a scenario
 * can assert on the token's own claims (`iss`, `aud`, `typ`, `alg`, ...) rather
 * than the server's introspection view of them.
 */

/** Base64url decode, tolerant of missing padding. */
export function base64urlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const normalized = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Split a compact JWT into [header, payload, signature] JSON strings. */
export function decodeJwtSegments(token: string): { header: unknown; payload: unknown } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error(`jwt capture: value is not a compact JWT (expected 3 dot-separated segments, got ${parts.length})`);
  }
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(base64urlDecode(parts[0]!));
  } catch {
    throw new Error('jwt capture: header segment is not valid base64url JSON');
  }
  try {
    payload = JSON.parse(base64urlDecode(parts[1]!));
  } catch {
    throw new Error('jwt capture: payload segment is not valid base64url JSON');
  }
  return { header, payload };
}

/** Read a (possibly dot-nested) field from a decoded JWT segment object. */
export function fieldAt(value: unknown, path: string): unknown {
  let node: unknown = value;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
