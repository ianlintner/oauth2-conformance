/**
 * Guards RFC attribution of core requirements: levels and clauses must match
 * the RFC text, and local policy must not be presented as an RFC server MUST.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfiles, loadRequirements, loadScenarios } from '../src/loader.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requirements = await loadRequirements(path.join(repoRoot, 'requirements'));
const profiles = await loadProfiles(path.join(repoRoot, 'profiles'));
const scenarioDocs = await loadScenarios(path.join(repoRoot, 'scenarios'));
const byId = new Map(requirements.map((r) => [r.id, r]));

function get(id: string) {
  const found = byId.get(id);
  assert.ok(found, `missing requirement ${id}`);
  return found;
}

test('RFC 9207 iss is form-urlencoded, never prohibited from encoding', () => {
  assert.equal(byId.has('RFC9207-3-iss-no-url-encoding'), false);
  const r = get('RFC9207-2.1-iss-form-urlencoded');
  assert.equal(r.clause, '2.1');
  assert.match(r.summary, /form-urlencoded/);
  assert.doesNotMatch(r.summary, /not (be )?URL-encoded/i);
  assert.match(get('RFC9207-2.3-iss-matches-metadata-issuer').summary, /decoded/);
});

test('RFC 8252 8.12 is a server MAY, not a server MUST NOT', () => {
  assert.equal(byId.has('RFC8252-8.12-no-embedded-user-agent'), false);
  assert.equal(get('RFC8252-8.12-as-may-block-embedded-user-agent').level, 'MAY');
});

test('RFC 9700 implicit rejection is local policy, not a server MUST NOT', () => {
  assert.equal(byId.has('RFC9700-2.1.2-implicit-grant-prohibited'), false);
  const r = get('RFC9700-2.1.2-implicit-grant-rejected-policy');
  assert.notEqual(r.level, 'MUST NOT');
  assert.match(r.notes ?? '', /clients SHOULD NOT/);
});

test('RFC 9700 2.6 prohibits http redirect URIs; the 308 upgrade and proxy rules are not RFC MUSTs', () => {
  assert.equal(get('RFC9700-2.6-no-http-redirect-uri').level, 'MUST NOT');
  assert.equal(get('RFC9700-2.6-http-upgrade-redirect-308').level, 'MAY');
  for (const id of ['RFC9700-4.13-forwarded-proto-trusted', 'RFC9700-4.13-forwarded-proto-untrusted']) {
    assert.equal(get(id).clause, '4.13');
    assert.notEqual(get(id).level, 'MUST');
  }
});

test('every core profile entry resolves to a requirement', () => {
  const core = profiles.find((p) => p.id === 'core');
  assert.ok(core);
  for (const id of core.requirements) assert.ok(byId.has(id), `profile references unknown ${id}`);
});

test('RFC 9700 code replay: rejection is a MUST, token revocation is only a SHOULD, both sourced beyond 2.1.1', () => {
  const rejected = get('RFC9700-2.1.1-code-replay-rejected');
  assert.equal(rejected.level, 'MUST');
  assert.match(rejected.notes ?? '', /RFC 6749 section 4\.1\.2/);
  assert.match(rejected.notes ?? '', /RFC 9700 section 4\.2\.4/);
  const revokes = get('RFC9700-2.1.1-code-replay-revokes-tokens');
  assert.equal(revokes.level, 'SHOULD');
  assert.match(revokes.summary, /\bshould\b/i);
  assert.match(revokes.notes ?? '', /SHOULD revoke/);
  assert.match(revokes.notes ?? '', /RFC 6749 section 4\.1\.2/);
  assert.match(revokes.notes ?? '', /RFC 9700 section 4\.2\.4/);
});

test('RFC 7636 4.2 plain rejection is local S256-only policy, not an RFC-imposed MUST NOT', () => {
  const r = get('RFC7636-4.2-plain-rejected');
  assert.equal(r.clause, '4.2');
  assert.notEqual(r.level, 'MUST NOT');
  assert.notEqual(r.level, 'MUST');
  assert.equal(r.level, 'MAY');
  assert.match(r.notes ?? '', /Local profile policy/);
  assert.match(r.notes ?? '', /does not prohibit/);
  assert.match(r.notes ?? '', /section 4\.4\.1/);
  const scenario = scenarioDocs.find((s) => s.requirements.includes('RFC7636-4.2-plain-rejected'));
  assert.ok(scenario, 'a scenario must cite RFC7636-4.2-plain-rejected');
  assert.match(scenario.note ?? '', /local (profile )?policy/i);
  assert.doesNotMatch(scenario.note ?? '', /RFC[- ]mandated|MUST NOT/);
});
