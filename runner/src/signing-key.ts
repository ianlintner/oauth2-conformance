/**
 * Shared ephemeral ES256 key material for runner-side JWT signing helpers.
 *
 * Both `client-assertion` (RFC 7523 / private_key_jwt) and `request-object`
 * (RFC 9101 JAR) sign a compact JWT whose public key must be made available to
 * the SUT for verification: the helper embeds the public JWK in the JWT header
 * (an explicit `jwk` header parameter), and also returns it in the helper body
 * so a scenario can publish it (or a test-only `kid`) to the SUT out of band.
 *
 * Keys are generated per-run and keyed by a `kid` slot in the scenario scope,
 * so a scenario can reuse the same key across multiple signing steps while
 * still getting a fresh `jti` each time.
 */

import { createPrivateKey, generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface SigningKey {
  /** ES256 private key (never returned in helper output). */
  privateKey: KeyObject;
  /** Public JWK subset safe to publish: kty/crv/x/y only. */
  publicJwk: Record<string, string>;
}

export function loadSigningKey(scope: Map<string, string>, kid: string): SigningKey {
  const slot = `__signing_key:${kid}`;
  let stored = scope.get(slot);
  if (stored === undefined) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    stored = JSON.stringify(privateKey.export({ format: 'jwk' }));
    scope.set(slot, stored);
  }
  const privateJwk = JSON.parse(stored) as JsonWebKey;
  const { kty, crv, x, y } = privateJwk;
  return {
    privateKey: createPrivateKey({ key: privateJwk, format: 'jwk' }),
    publicJwk: { kty: kty ?? '', crv: crv ?? '', x: x ?? '', y: y ?? '' },
  };
}

export function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** Sign a signing input with the given private key, ES256 (IEEE P-1363). */
export function signEs256(privateKey: KeyObject, signingInput: string): string {
  return b64url(sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
}