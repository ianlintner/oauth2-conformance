/**
 * Semantic guards for the sender-constrained scenarios (contract v0.5).
 *
 * Most scenarios are draft: the runner has a DPoP signer (`dpop-proof`) but no mTLS transport.
 * The guards stop them from asserting a rejection for the wrong reason, which
 * would be false MUST coverage once a helper exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadScenarios } from '../src/loader.js';
import type { Scenario, ScenarioStep } from '../src/scenario.js';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const all = (await loadScenarios(path.join(repoRoot, 'scenarios', 'sender-constrained'))).filter((s) => s.profile === 'sender-constrained');
const byId = new Map(all.map((s) => [s.id, s]));
const get = (id: string): Scenario => {
  const found = byId.get(`sender-constrained.${id}`);
  assert.ok(found, `missing scenario ${id}`);
  return found;
};
const text = (step: ScenarioStep) => JSON.stringify(step);
const userinfoSteps = (s: Scenario) => s.steps.filter((st) => st.request?.path === '/oauth/userinfo');

/** Scenarios validated against the Rust reference with the `dpop-proof` helper (part 3/3). Any other scenario stays draft. */
const VALIDATED_STABLE = [
  'dpop.token-type-dpop', 'dpop.jti-required', 'dpop.jti-replay', 'dpop.htm-binding',
  'dpop.htu-binding', 'dpop.typ-header', 'dpop.iat-stale',
].map((id) => `sender-constrained.${id}`);

test('only the Rust-validated dpop-proof scenarios are stable; every other sender-constrained scenario is draft', () => {
  for (const s of all) assert.equal(s.status, VALIDATED_STABLE.includes(s.id) ? 'stable' : 'draft', s.id);
  for (const id of VALIDATED_STABLE) assert.ok(byId.has(id), id);
});

test('stable dpop-proof scenarios sign their proof first and send it, one deliberate difference from the valid control', () => {
  for (const id of VALIDATED_STABLE) {
    const s = byId.get(id)!;
    assert.equal(s.steps[0]?.use, 'dpop-proof', id);
    assert.ok(s.steps.some((st) => st.request?.headers?.dpop === '{{proof_value}}'), id);
  }
  const control = byId.get('sender-constrained.dpop.token-type-dpop')!;
  assert.equal(control.steps.at(-1)?.expect?.status, 200, 'positive control: the unmodified proof is accepted');
});

test('no resource step presents a client_credentials token to /oauth/userinfo', () => {
  for (const s of all) {
    if (userinfoSteps(s).length === 0) continue;
    assert.ok(!s.steps.some((st) => text(st).includes('client_credentials')), `${s.id} uses client_credentials with userinfo`);
    assert.ok(s.steps.some((st) => st.use === 'login-and-authorize' && JSON.stringify(st.with).includes('openid')), `${s.id} needs an openid user token`);
  }
});

test('resource rejection scenarios carry a positive control before the mutated request', () => {
  for (const id of ['dpop.ath-mismatch', 'dpop.wrong-key', 'dpop.ath-required', 'mtls.resource-cert-must-match']) {
    const s = get(id);
    const resource = s.steps.filter((st) => st.request?.path === '/oauth/userinfo' || (st.use === 'mtls-request' && JSON.stringify(st.with).includes('/oauth/userinfo')));
    assert.ok(resource.length >= 2, `${id} needs control + mutation`);
    assert.equal(resource[0]!.expect?.status, 200, `${id} first resource request must succeed`);
    assert.equal(resource[resource.length - 1]!.expect?.status, 401, `${id} mutated request must fail`);
  }
});

test('mTLS scenarios use a certificate-bearing transport helper and never DPoP', () => {
  for (const s of all.filter((x) => x.id.startsWith('sender-constrained.mtls.') && !x.id.endsWith('discovery-cert-bound'))) {
    assert.ok(s.steps.some((st) => st.use === 'mtls-request'), `${s.id} must send a client certificate`);
    assert.ok(!s.steps.some((st) => /dpop/i.test(text(st))), `${s.id} must not use DPoP`);
  }
  const dn = get('mtls.tls-client-auth-dn');
  assert.ok(dn.steps.some((st) => st.expect?.status === 200), 'DN scenario needs a positive control');
});

test('DPoP-Nonce presence uses a header capture, not a literal $nonempty header', () => {
  for (const s of all) for (const st of s.steps) assert.notEqual(st.expect?.headers?.['dpop-nonce'], '$nonempty', `${s.id}.${st.id}`);
  for (const id of ['dpop.use-dpop-nonce', 'dpop.nonce-response-header', 'dpop.forged-nonce', 'dpop.stale-nonce']) {
    assert.ok(get(id).steps.some((st) => st.capture?.nonce === 'header.dpop-nonce'), id);
  }
});

test('htu-query-ignored differs from htu-binding: a query on the request URI must not break a matching htu', () => {
  const q = get('dpop.htu-query-ignored');
  assert.ok(q.steps.some((st) => st.request?.query !== undefined && st.expect?.status === 200));
  assert.notDeepEqual(q.steps.map(text), get('dpop.htu-binding').steps.map(text));
});

test('token-sender-constrained shows bearer downgrade is rejected, not just issuance', () => {
  const s = get('dpop.token-sender-constrained');
  assert.ok(userinfoSteps(s).some((st) => /^Bearer /.test(st.request?.headers?.authorization ?? '') && st.expect?.status === 401));
  assert.ok(userinfoSteps(s).some((st) => /^DPoP /.test(st.request?.headers?.authorization ?? '') && st.expect?.status === 200));
});

test('jwk-usable-algorithm covers symmetric alg and private-key jwk with a positive control', () => {
  const s = get('dpop.jwk-usable-algorithm');
  const t = s.steps.map(text).join('\n');
  assert.match(t, /proof_symmetric_alg/);
  assert.match(t, /proof_jwk_private_key/);
  assert.match(t, /proof_token_ok/);
});

test('replay variants use restart and per-instance controls', () => {
  assert.ok(get('dpop.replay-restart').steps.some((st) => st.use === 'sut-restart'));
  const x = get('dpop.replay-cross-instance').steps.filter((st) => st.use === 'request-on-instance');
  assert.ok(x.length >= 2);
  assert.notEqual(JSON.stringify(x[0]!.with?.instance), JSON.stringify(x[x.length - 1]!.with?.instance));
});

test('placeholder-only scenarios are draft and say so (a bare 200 is not evidence)', () => {
  for (const id of ['abuse.rate-limit-per-client', 'abuse.success-not-counted']) {
    const s = get(id);
    assert.equal(s.status, 'draft', id);
    assert.match(s.note ?? '', /NOT coverage/, id);
    assert.match(s.note ?? '', /placeholder/, id);
    assert.ok(s.steps.some((st) => st.expect?.status === 401), `${id} must exercise a failed-auth step, not only a 200`);
  }
  const cnf = get('mtls.cnf-x5t');
  assert.equal(cnf.status, 'draft');
  assert.ok(cnf.steps.some((st) => JSON.stringify(st.assert ?? {}).includes('x5t#S256')), 'cnf-x5t must assert the cnf claim, not only issuance');
  assert.match(cnf.note ?? '', /NOT evidence of binding/);
});

test('declared-but-unimplemented helpers defer, never pass (draft scenarios cannot become false evidence)', async () => {
  const { runScenarios } = await import('../src/runner.js');
  const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  for (const s of all.filter((x) => x.status === 'draft' && x.steps.some((st) => st.use !== undefined && !['login-and-authorize'].includes(st.use)))) {
    const report = await runScenarios([s], { baseUrl: 'http://sut.invalid', implementation: 'fake', contract: '0.5.0', fetchImpl, helpers: {} });
    assert.equal(report.results[0]!.outcome, 'deferred', s.id);
    assert.notEqual(report.verdict === 'pass' && report.passed > 0, true, s.id);
  }
});

test('runner transmits request headers, content-type and URL-encoded form body (kills header-drop / form-drop mutations)', async () => {
  const { runScenarios } = await import('../src/runner.js');
  const seen: Array<{ url: string; method?: string; headers: Record<string, string>; body?: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, ...(init.method !== undefined ? { method: init.method } : {}), headers: { ...(init.headers as Record<string, string>) }, ...(typeof init.body === 'string' ? { body: init.body } : {}) });
    return new Response('{"token_type":"DPoP","access_token":"x"}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const scenario: Scenario = {
    id: 'test.sender.capture', requirements: ['R'], profile: 'sender-constrained', status: 'stable',
    steps: [{ id: 's', request: { method: 'POST', path: '/oauth/token', query: { probe: '1' }, headers: { authorization: 'Basic abc', dpop: 'proof.jwt.value' }, form: { grant_type: 'client_credentials', scope: 'a b' } }, expect: { status: 200 } }],
  };
  const report = await runScenarios([scenario], { baseUrl: 'http://sut.invalid', implementation: 'fake', contract: '0.5.0', fetchImpl });
  assert.equal(report.results[0]!.outcome, 'pass');
  assert.equal(seen.length, 1);
  const req = seen[0]!;
  assert.equal(req.url, 'http://sut.invalid/oauth/token?probe=1');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['authorization'], 'Basic abc');
  assert.equal(req.headers['dpop'], 'proof.jwt.value');
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(req.body).get('grant_type'), 'client_credentials');
  assert.equal(new URLSearchParams(req.body).get('scope'), 'a b');
});
