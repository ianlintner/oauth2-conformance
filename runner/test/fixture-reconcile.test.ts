/**
 * Regression tests for stable-fixture and attribution defects found when
 * reconciling the live core failures (t_373273ab). Each scenario below used to
 * fail against a correctly seeded SUT for a reason that lived in the fixture
 * (wrong client, wrong status, an unrequired JSON body), so the failure could
 * not be read as an implementation deviation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { loadRequirements, loadScenarios } from '../src/loader.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scenarios = await loadScenarios(path.join(repoRoot, 'scenarios'));
const requirements = await loadRequirements(path.join(repoRoot, 'requirements'));

function scenario(id: string) {
  const found = scenarios.find((s) => s.id === id);
  assert.ok(found, `missing scenario ${id}`);
  return found;
}

function basicCredentials(header: string | undefined): string {
  assert.match(header ?? '', /^Basic /);
  return Buffer.from((header ?? '').slice('Basic '.length), 'base64').toString('utf8');
}

test('dual-auth-rejected uses a client permitted the grant, so the single-method rule is what is tested', () => {
  const s = scenario('core.token.dual-auth-rejected');
  assert.equal(s.status, 'stable');
  const step = s.steps[0];
  assert.ok(step?.request);
  // client-a is not allowed client_credentials; the SUT answers unauthorized_client
  // before it ever inspects the credential channels, which hides the rule under test.
  assert.equal(basicCredentials(step.request.headers?.authorization), 'client-cc:test-only-cc-secret');
  assert.equal(step.request.form?.client_id, 'client-cc');
  assert.equal(step.request.form?.client_secret, 'test-only-cc-secret');
  // RFC 6749 5.2 lists multiple credentials / more than one mechanism under invalid_request.
  assert.equal(step.expect?.status, 400);
  assert.deepEqual(step.expect?.json, { error: 'invalid_request' });
});

test('unsupported-grant-type authenticates the client so the grant type is what is rejected', () => {
  const s = scenario('core.token.unsupported-grant-type');
  assert.equal(s.status, 'stable');
  const step = s.steps[0];
  assert.ok(step?.request);
  assert.equal(basicCredentials(step.request.headers?.authorization), 'client-a:test-only-secret');
  assert.deepEqual(step.expect?.json, { error: 'unsupported_grant_type' });
});

test('client-id-missing asserts the non-redirect 400, not a JSON body RFC 6749 4.1.2.1 does not require', () => {
  const s = scenario('core.authorize.client-id-missing');
  assert.equal(s.status, 'stable');
  const expect = s.steps[0]?.expect;
  assert.equal(expect?.status, 400);
  assert.equal(expect?.json, undefined);
  assert.equal(expect?.redirect, undefined);
});

test('RFC 8252 exact-match requirements cite section 8.4, where the server MUST is stated', () => {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  for (const id of [
    'RFC8252-7.3-loopback-path-exact',
    'RFC8252-7.3-loopback-scheme-exact',
    'RFC8252-7.3-loopback-families-distinct',
    'RFC8252-7.3-non-loopback-exact',
    'RFC8252-7.1-private-uri-scheme-exact',
  ]) {
    const r = byId.get(id);
    assert.ok(r, id);
    assert.equal(r.level, 'MUST', id);
    assert.equal(r.clause, '8.4', id);
    assert.match(r.link, /rfc8252#section-8\.4$/, id);
    assert.match(r.notes ?? '', /section 8\.4/, id);
  }
});

test('docs/core-coverage.md reports the measured live failures and the SUT launch conditions', async () => {
  const doc = await readFile(path.join(repoRoot, 'docs', 'core-coverage.md'), 'utf8');
  const match = /executed=43 passed=(\d+) failed=(\d+) deferred=(\d+)/.exec(doc);
  assert.ok(match, 'the measured live run line must be present');
  const failed = Number(match[2]);
  // Every stable scenario named in the failing list must exist and be stable; the
  // count in the header must equal the number of names listed.
  const list = /Still failing, executable stable scenarios[^\n]*\n\n((?:- core\.[^\n]+\n)+)/.exec(doc);
  assert.ok(list, 'a bulleted list of failing stable scenario ids must follow');
  const ids = [...(list[1] ?? '').matchAll(/- (core\.[\w.-]+)/g)].map((m) => m[1] as string);
  assert.equal(ids.length, failed, 'the listed failing scenarios must equal the failed count');
  for (const id of ids) assert.equal(scenario(id).status, 'stable', `${id} must be a stable scenario`);
  assert.ok(!ids.includes('core.authorize.metadata-issuer'), 'metadata-issuer passes when the SUT issuer is http://localhost:8080');
  assert.match(doc, /OAUTH2_PUBLIC_URL/, 'the SUT launch setting the fixtures assume must be documented');
  assert.match(doc, /rate limit/i, 'the SUT login rate limit that makes repeated runs flake must be documented');
});
