/**
 * RFC 9101 JAR request-object signing helper (`use: request-object`).
 *
 * Builds a signed (or tampered) JAR request object as a compact JWT and returns
 * it as a synthetic response `{ request, kid, jwk }`. A scenario captures
 * `body.request` and sends it as the `request` authorization-endpoint parameter,
 * and can read `body.jwk`/`body.kid` to publish the key via a seeded client
 * `jwks` entry.
 *
 * `with` arguments (values may use `{{var}}`):
 * - `client_id` (required): becomes `iss`, `sub` and the `client_id` claim.
 * - `aud` (default issuer from scratch): the request-object audience.
 * - `redirect_uri`, `response_type`, `scope`, `state`, `code_challenge`,
 *   `code_challenge_method`: authorization parameters carried verbatim into the
 *   request object.
 * - `authorization_details`: a JSON string (array of RAR authorization-details
 *   objects) parsed and carried verbatim as the `authorization_details` claim.
 * - `kid` (default `request-object`): named ephemeral key.
 * - `tamper`: `bad_sig` or `alg_none`, as in `client-assertion`.
 * - `exp`: seconds-from-now; request objects carry an `exp` by default (300s)
 *   unless `omit` drops it.
 * - `omit`: claims to drop, from `iss`, `aud`, `exp`, `iat`, `jti`, `client_id`.
 */

import { randomUUID } from 'node:crypto';
import { interpolate } from './scenario.js';
import { b64url, loadSigningKey, signEs256 } from './signing-key.js';
import type { HelperContext } from './runner.js';

const OMITTABLE = ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id'] as const;
const TAMPER = ['bad_sig', 'alg_none'] as const;

function str(context: HelperContext, name: string): string | undefined {
  const value = context.with[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`request-object: with.${name} must be a nonempty string`);
  return interpolate(value, context.scope);
}

export async function requestObject(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const with_ = context.with;
  const clientId = str(context, 'client_id');
  if (clientId === undefined) throw new Error('request-object: with.client_id is required');

  const omit = with_.omit ?? [];
  if (!Array.isArray(omit) || omit.some((entry) => !(OMITTABLE as readonly unknown[]).includes(entry))) {
    throw new Error(`request-object: with.omit entries must be among ${OMITTABLE.join(', ')}`);
  }
  const tamper = with_.tamper;
  if (tamper !== undefined && !(TAMPER as readonly unknown[]).includes(tamper)) {
    throw new Error(`request-object: with.tamper must be one of ${TAMPER.join(', ')}`);
  }

  const kid = str(context, 'kid') ?? 'request-object';
  const { privateKey, publicJwk } = loadSigningKey(context.scope, kid);

  const claims: Record<string, unknown> = {
    iss: clientId,
    sub: clientId,
    aud: str(context, 'aud') ?? 'http://localhost:8080',
    client_id: clientId,
    iat: Math.floor(Date.now() / 1000),
    jti: str(context, 'jti') ?? randomUUID(),
    exp: Math.floor(Date.now() / 1000 + 300),
  };

  for (const name of ['redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method'] as const) {
    const value = str(context, name);
    if (value !== undefined) claims[name] = value;
  }

  const rawDetails = str(context, 'authorization_details');
  if (rawDetails !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDetails);
    } catch {
      throw new Error('request-object: with.authorization_details must be a JSON array string');
    }
    if (!Array.isArray(parsed)) throw new Error('request-object: with.authorization_details must be a JSON array string');
    claims.authorization_details = parsed;
  }

  for (const name of omit as string[]) delete claims[name];

  const header: Record<string, unknown> = { typ: str(context, 'typ') ?? 'oauth-authz-req+jwt', alg: str(context, 'alg') ?? 'ES256', jwk: publicJwk };

  let headerSegment = b64url(JSON.stringify(header));
  const payloadSegment = b64url(JSON.stringify(claims));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  let signature = signEs256(privateKey, signingInput);

  if (tamper === 'alg_none') {
    header.alg = 'none';
    delete header.jwk;
    headerSegment = b64url(JSON.stringify(header));
    return { status: 200, headers: {}, body: { request: `${headerSegment}.${payloadSegment}.`, kid, jwk: publicJwk } };
  }
  if (tamper === 'bad_sig') signature = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;

  return { status: 200, headers: {}, body: { request: `${signingInput}.${signature}`, kid, jwk: publicJwk } };
}