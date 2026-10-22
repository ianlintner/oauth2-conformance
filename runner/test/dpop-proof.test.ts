import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { dpopProof } from '../src/dpop.js';
import { base64urlDecode, decodeJwtSegments } from '../src/jwt.js';
import type { HelperContext } from '../src/runner.js';

function ctx(withArgs: Record<string, unknown>, scope = new Map<string, string>()): HelperContext {
  return { with: withArgs, scope, send: async () => ({ status: 0, headers: {} }) } as unknown as HelperContext;
}

async function proofOf(withArgs: Record<string, unknown>, scope = new Map<string, string>()) {
  const response = await dpopProof(ctx(withArgs, scope));
  assert.equal(response.status, 200);
  const body = response.body as { proof: string; jkt: string };
  return { ...body, ...decodeJwtSegments(body.proof) } as { proof: string; jkt: string; header: Record<string, unknown>; payload: Record<string, unknown> };
}

test('default proof carries typ dpop+jwt, ES256, public jwk and htm/htu/iat/jti', async () => {
  const p = await proofOf({ htm: 'POST', htu: 'http://localhost:8080/oauth/token' });
  assert.equal(p.header.typ, 'dpop+jwt');
  assert.equal(p.header.alg, 'ES256');
  const jwk = p.header.jwk as Record<string, string>;
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.d, undefined, 'private key must never be embedded');
  assert.equal(p.payload.htm, 'POST');
  assert.equal(p.payload.htu, 'http://localhost:8080/oauth/token');
  assert.equal(typeof p.payload.jti, 'string');
  assert.ok(Math.abs((p.payload.iat as number) - Date.now() / 1000) < 5);
});

test('signature verifies against the embedded jwk', async () => {
  const p = await proofOf({ htm: 'GET', htu: 'http://x/y' });
  const [h, pl, sig] = p.proof.split('.');
  const key = createPublicKey({ key: p.header.jwk as never, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')));
});

test('jkt is the RFC 7638 thumbprint of the embedded jwk', async () => {
  const p = await proofOf({ htm: 'GET', htu: 'http://x/y' });
  const j = p.header.jwk as Record<string, string>;
  const canon = JSON.stringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y });
  assert.equal(p.jkt, createHash('sha256').update(canon).digest('base64url'));
});

test('named key is reused across calls; distinct names give distinct keys', async () => {
  const scope = new Map<string, string>();
  const a1 = await proofOf({ htm: 'GET', htu: 'u', key: 'a' }, scope);
  const a2 = await proofOf({ htm: 'GET', htu: 'u', key: 'a' }, scope);
  const b = await proofOf({ htm: 'GET', htu: 'u', key: 'b' }, scope);
  assert.equal(a1.jkt, a2.jkt);
  assert.notEqual(a1.jkt, b.jkt);
  assert.notEqual(a1.payload.jti, a2.payload.jti, 'each proof gets a fresh jti');
});

test('ath is the base64url SHA-256 of the access token variable', async () => {
  const scope = new Map([['at', 'token-value']]);
  const p = await proofOf({ htm: 'GET', htu: 'u', ath_token: '{{at}}' }, scope);
  assert.equal(p.payload.ath, createHash('sha256').update('token-value').digest('base64url'));
});

test('overrides: typ, htm, iat_offset, nonce, jti, alg-free omit list', async () => {
  const scope = new Map([['n', 'nonce-1']]);
  const p = await proofOf({ htm: 'GET', htu: 'u', typ: 'JWT', iat_offset: -3600, nonce: '{{n}}', jti: 'fixed', omit: ['htm'] }, scope);
  assert.equal(p.header.typ, 'JWT');
  assert.equal(p.payload.htm, undefined);
  assert.equal(p.payload.nonce, 'nonce-1');
  assert.equal(p.payload.jti, 'fixed');
  assert.ok(Math.abs((p.payload.iat as number) - (Date.now() / 1000 - 3600)) < 5);
});

test('omit jti drops the claim', async () => {
  const p = await proofOf({ htm: 'GET', htu: 'u', omit: ['jti'] });
  assert.equal(p.payload.jti, undefined);
});

test('rejects missing htm/htu and unknown omit entries', async () => {
  await assert.rejects(dpopProof(ctx({ htu: 'u' })), /with\.htm/);
  await assert.rejects(dpopProof(ctx({ htm: 'GET' })), /with\.htu/);
  await assert.rejects(dpopProof(ctx({ htm: 'GET', htu: 'u', omit: ['nope'] })), /omit/);
});

test('proof segments are valid base64url JSON', async () => {
  const p = await proofOf({ htm: 'GET', htu: 'u' });
  JSON.parse(base64urlDecode(p.proof.split('.')[0]!));
});
