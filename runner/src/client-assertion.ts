/**
 * RFC 7523 / private_key_jwt client-assertion signing helper (`use: client-assertion`).
 *
 * Signs a client-assertion JWT (grant and client-auth forms) and returns it as a
 * synthetic response `{ assertion, kid, jwk }`, mirroring the `dpop-proof`
 * helper's capture pattern. A scenario captures `body.assertion` and sends it as
 * the `assertion` (grant form) or `client_assertion` (client-auth form) parameter,
 * and can also read `body.jwk`/`body.kid` to publish the public key via a seeded
 * client `jwks` entry.
 *
 * `with` arguments (string values may use `{{var}}`):
 * - `iss`, `sub`, `aud` (defaults to issuer from scratch): the claims.
 * - `kid` (default `client-assertion`): named ephemeral key; reuse the name to
 *   keep the same key, a new name for a wrong-key test.
 * - `exp`: seconds-from-now override; when absent, `exp` is omitted (so an
 *   `omit`/missing-exp negative case is expressible). `iat` is always present.
 * - `jti`: literal override; otherwise a fresh random UUID each call.
 * - `alg`: header alg override (default `ES256`).
 * - `tamper`: `bad_sig` (flip the signature), or `alg_none` (alg:none, empty sig).
 * - `omit`: claims to drop, from `iss`, `sub`, `aud`, `exp`, `jti`, `iat`.
 */

import { randomUUID } from 'node:crypto';
import { interpolate } from './scenario.js';
import { b64url, loadSigningKey, signEs256 } from './signing-key.js';
import type { HelperContext } from './runner.js';

const OMITTABLE = ['iss', 'sub', 'aud', 'exp', 'jti', 'iat'] as const;
const TAMPER = ['bad_sig', 'alg_none'] as const;

function str(context: HelperContext, name: string): string | undefined {
  const value = context.with[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`client-assertion: with.${name} must be a nonempty string`);
  return interpolate(value, context.scope);
}

export async function clientAssertion(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const with_ = context.with;
  const omit = with_.omit ?? [];
  if (!Array.isArray(omit) || omit.some((entry) => !(OMITTABLE as readonly unknown[]).includes(entry))) {
    throw new Error(`client-assertion: with.omit entries must be among ${OMITTABLE.join(', ')}`);
  }
  const tamper = with_.tamper;
  if (tamper !== undefined && !(TAMPER as readonly unknown[]).includes(tamper)) {
    throw new Error(`client-assertion: with.tamper must be one of ${TAMPER.join(', ')}`);
  }

  const kid = str(context, 'kid') ?? 'client-assertion';
  const { privateKey, publicJwk } = loadSigningKey(context.scope, kid);

  const exp = with_.exp;
  if (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp))) {
    throw new Error('client-assertion: with.exp must be a number (seconds from now)');
  }

  const header: Record<string, unknown> = { typ: str(context, 'typ') ?? 'JWT', alg: str(context, 'alg') ?? 'ES256', jwk: publicJwk };
  const claims: Record<string, unknown> = {
    iss: str(context, 'iss'),
    sub: str(context, 'sub'),
    aud: str(context, 'aud'),
    iat: Math.floor(Date.now() / 1000),
    jti: str(context, 'jti') ?? randomUUID(),
  };
  if (exp !== undefined) claims.exp = Math.floor(Date.now() / 1000 + exp);
  for (const name of omit as string[]) delete claims[name];

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let signature = signEs256(privateKey, signingInput);
  if (tamper === 'alg_none') {
    header.alg = 'none';
    delete header.jwk;
    const noneInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    return { status: 200, headers: {}, body: { assertion: `${noneInput}.`, kid, jwk: publicJwk } };
  }
  if (tamper === 'bad_sig') signature = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;

  return { status: 200, headers: {}, body: { assertion: `${signingInput}.${signature}`, kid, jwk: publicJwk } };
}