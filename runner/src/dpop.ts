/**
 * RFC 9449 DPoP proof signing helper (`use: dpop-proof`).
 *
 * Runner-only: DPoP is plain HTTP, so no SUT interface change is needed. The
 * helper signs an ES256 proof JWT and returns it as a synthetic response whose
 * body is `{ proof, jkt }`, so a scenario captures it with
 * `capture: { proof: body.proof }` and sends it in a `DPoP` header.
 *
 * `with` arguments (string values may use `{{var}}`):
 * - `htm`, `htu` (required): the claims; set them deliberately wrong to test binding.
 * - `key` (default `default`): named ephemeral key; the same name reuses the key
 *   within a scenario, a different name yields a second key (wrong-key tests).
 * - `ath_token`: access token whose base64url SHA-256 becomes `ath`.
 * - `ath`, `nonce`, `jti`: literal claim overrides.
 * - `typ`: header typ override (default `dpop+jwt`).
 * - `iat_offset`: seconds added to now (negative = stale/backdated proof).
 * - `omit`: claims to drop, from `htm`, `htu`, `iat`, `jti`.
 *
 * To replay a proof byte-for-byte, capture it once and reuse the variable; each
 * helper call signs with a fresh `jti` unless `jti` is given.
 */

import { createHash, generateKeyPairSync, randomUUID, sign, type JsonWebKey, type KeyObject, createPrivateKey } from 'node:crypto';
import { interpolate } from './scenario.js';
import type { HelperContext } from './runner.js';

const OMITTABLE = ['htm', 'htu', 'iat', 'jti'] as const;

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function str(context: HelperContext, name: string): string | undefined {
  const value = context.with[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`dpop-proof: with.${name} must be a nonempty string`);
  return interpolate(value, context.scope);
}

function loadKey(context: HelperContext, name: string): { privateKey: KeyObject; publicJwk: Record<string, string> } {
  const slot = `__dpop_key:${name}`;
  let stored = context.scope.get(slot);
  if (stored === undefined) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    stored = JSON.stringify(privateKey.export({ format: 'jwk' }));
    context.scope.set(slot, stored);
  }
  const privateJwk = JSON.parse(stored) as JsonWebKey;
  const { kty, crv, x, y } = privateJwk;
  return { privateKey: createPrivateKey({ key: privateJwk, format: 'jwk' }), publicJwk: { kty: kty ?? '', crv: crv ?? '', x: x ?? '', y: y ?? '' } };
}

export async function dpopProof(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const htm = str(context, 'htm');
  const htu = str(context, 'htu');
  if (htm === undefined) throw new Error('dpop-proof: with.htm is required');
  if (htu === undefined) throw new Error('dpop-proof: with.htu is required');
  const omit = context.with.omit ?? [];
  if (!Array.isArray(omit) || omit.some((entry) => !(OMITTABLE as readonly unknown[]).includes(entry))) {
    throw new Error(`dpop-proof: with.omit entries must be among ${OMITTABLE.join(', ')}`);
  }
  const offset = context.with.iat_offset ?? 0;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) throw new Error('dpop-proof: with.iat_offset must be a number');

  const { privateKey, publicJwk } = loadKey(context, str(context, 'key') ?? 'default');
  const header = { typ: str(context, 'typ') ?? 'dpop+jwt', alg: 'ES256', jwk: publicJwk };

  const claims: Record<string, unknown> = {
    jti: str(context, 'jti') ?? randomUUID(),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000 + offset),
  };
  for (const name of omit as string[]) delete claims[name];
  const athToken = str(context, 'ath_token');
  const ath = str(context, 'ath') ?? (athToken !== undefined ? createHash('sha256').update(athToken).digest('base64url') : undefined);
  if (ath !== undefined) claims.ath = ath;
  const nonce = str(context, 'nonce');
  if (nonce !== undefined) claims.nonce = nonce;

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });

  // RFC 7638 thumbprint: required members in lexicographic order.
  const jkt = createHash('sha256')
    .update(JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }))
    .digest('base64url');

  return { status: 200, headers: {}, body: { proof: `${signingInput}.${b64url(signature)}`, jkt } };
}
