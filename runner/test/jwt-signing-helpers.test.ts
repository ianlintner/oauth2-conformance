import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { clientAssertion } from '../src/client-assertion.js';
import { requestObject } from '../src/request-object.js';
import { decodeJwtSegments } from '../src/jwt.js';
import type { HelperContext } from '../src/runner.js';

function ctx(withArgs: Record<string, unknown>, scope = new Map<string, string>()): HelperContext {
  return { with: withArgs, scope, send: async () => ({ status: 0, headers: {} }) } as unknown as HelperContext;
}

async function assertionOf(withArgs: Record<string, unknown>, scope = new Map<string, string>()) {
  const response = await clientAssertion(ctx(withArgs, scope));
  assert.equal(response.status, 200);
  const body = response.body as { assertion: string; kid: string; jwk: Record<string, string> };
  return { ...body, ...decodeJwtSegments(body.assertion) } as {
    assertion: string;
    kid: string;
    jwk: Record<string, string>;
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
}

async function requestOf(withArgs: Record<string, unknown>, scope = new Map<string, string>()) {
  const response = await requestObject(ctx(withArgs, scope));
  assert.equal(response.status, 200);
  const body = response.body as { request: string; kid: string; jwk: Record<string, string> };
  return { ...body, ...decodeJwtSegments(body.request) } as {
    request: string;
    kid: string;
    jwk: Record<string, string>;
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
}

test('a client assertion carries iss/sub/aud/exp/jti and no private key', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'http://localhost:8080/oauth/token', jti: 'j-1' });
  assert.equal(a.header.alg, 'ES256');
  assert.equal(a.header.typ, 'JWT');
  assert.equal(a.payload.iss, 'client-a');
  assert.equal(a.payload.sub, 'client-a');
  assert.equal(a.payload.aud, 'http://localhost:8080/oauth/token');
  assert.equal(a.payload.jti, 'j-1');
  assert.equal(a.payload.exp, undefined, 'exp defaults absent unless requested');
  assert.equal(typeof a.payload.iat, 'number');
  assert.equal((a.jwk as Record<string, unknown>).d, undefined, 'private key must never be embedded');
});

test('an assertion signature verifies against its embedded public jwk', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u' });
  const [h, pl, sig] = a.assertion.split('.');
  const key = createPublicKey({ key: a.jwk as never, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')));
});

test('a named key is reused so the SUT can pin the same kid across calls', async () => {
  const scope = new Map<string, string>();
  const a1 = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', kid: 'k1' }, scope);
  const a2 = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', kid: 'k1' }, scope);
  assert.equal(a1.kid, 'k1');
  assert.equal(a1.kid, a2.kid);
  assert.equal(a1.jwk.x, a2.jwk.x);
});

test('exp and deliberate expiry are forwarded', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', exp: 3600 });
  assert.ok(Math.abs((a.payload.exp as number) - (Math.floor(Date.now() / 1000) + 3600)) < 5);
});

test('tamper: bad_sig produces a signature that does not verify', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', tamper: 'bad_sig' });
  const [h, pl, sig] = a.assertion.split('.');
  const key = createPublicKey({ key: a.jwk as never, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')), false);
});

test('tamper: alg_none drops the signature and sets alg to none', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', tamper: 'alg_none' });
  assert.equal(a.header.alg, 'none');
  assert.equal(a.assertion.split('.').length, 3, 'still compact (empty signature segment)');
  assert.equal(a.assertion.endsWith('.'), true);
});

test('omit drops a named claim', async () => {
  const a = await assertionOf({ iss: 'client-a', sub: 'client-a', aud: 'u', omit: ['exp', 'jti'] });
  assert.equal(a.payload.jti, undefined);
});

test('rejects unknown tamper and omit entries', async () => {
  await assert.rejects(clientAssertion(ctx({ iss: 'c', sub: 'c', aud: 'u', tamper: 'nope' })), /tamper/);
  await assert.rejects(clientAssertion(ctx({ iss: 'c', sub: 'c', aud: 'u', omit: ['nope'] })), /omit/);
});

test('a request object carries iss/aud/client_id plus authorization parameters', async () => {
  const r = await requestOf({ client_id: 'client-a', aud: 'http://localhost:8080', redirect_uri: 'https://client.example/callback', response_type: 'code', scope: 'read', state: 's1' });
  assert.equal(r.header.alg, 'ES256');
  assert.equal(r.header.typ, 'oauth-authz-req+jwt');
  assert.equal(r.payload.iss, 'client-a');
  assert.equal(r.payload.aud, 'http://localhost:8080');
  assert.equal(r.payload.client_id, 'client-a');
  assert.equal(r.payload.redirect_uri, 'https://client.example/callback');
  assert.equal(r.payload.response_type, 'code');
  assert.equal(r.payload.scope, 'read');
  assert.equal(r.payload.state, 's1');
});

test('authorization_details (RAR) are carried verbatim into the request object', async () => {
  const details = [{ type: 'payment_initiation', actions: ['initiate'] }];
  const r = await requestOf({ client_id: 'client-a', aud: 'u', authorization_details: JSON.stringify(details) });
  assert.deepEqual(r.payload.authorization_details, details);
});

test('a request object signature verifies', async () => {
  const r = await requestOf({ client_id: 'client-a', aud: 'u' });
  const [h, pl, sig] = r.request.split('.');
  const key = createPublicKey({ key: r.jwk as never, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')));
});

test('request object supports alg_none tampering and bad signatures', async () => {
  const none = await requestOf({ client_id: 'client-a', aud: 'u', tamper: 'alg_none' });
  assert.equal(none.header.alg, 'none');
  const bad = await requestOf({ client_id: 'client-a', aud: 'u', tamper: 'bad_sig' });
  const [h, pl, sig] = bad.request.split('.');
  const key = createPublicKey({ key: bad.jwk as never, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')), false);
});

test('request object requires a client_id', async () => {
  await assert.rejects(requestObject(ctx({ aud: 'u' })), /client_id/);
});