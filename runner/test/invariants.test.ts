/**
 * Invariant catalog self-test.
 *
 * Every named invariant in invariants/*.yaml must parse, cite an existing
 * core requirement, and use a well-formed INV- id. Scenarios reference
 * invariants only in prose (note text); the machine wiring arrives in
 * part 3/3, so this test guards the catalog's own consistency today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadRequirements } from '../src/loader.js';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const requirements = await loadRequirements(path.join(repoRoot, 'requirements'));
const requirementIds = new Set(requirements.map((r) => r.id));

interface Invariant {
  id: string;
  profile: string;
  summary: string;
  requirement: string;
}

const entries = await readdir(path.join(repoRoot, 'invariants'));
const invariants: Invariant[] = [];
for (const file of entries) {
  if (!/\.ya?ml$/.test(file)) continue;
  const docs = parseYaml(await readFile(path.join(repoRoot, 'invariants', file), 'utf8')) as Invariant[];
  invariants.push(...(Array.isArray(docs) ? docs : [docs]));
}

test('invariant catalog is nonempty and well-formed', () => {
  assert.ok(invariants.length > 0, 'invariants/ must contain at least one invariant');
  for (const inv of invariants) {
    assert.match(inv.id, /^INV-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/, `bad invariant id ${inv.id}`);
    assert.ok(inv.profile === 'core' || inv.profile === 'token-lifecycle' || inv.profile === 'oidc-basic' || inv.profile === 'extended-grants', `unknown invariant profile ${inv.profile}`);
    assert.ok(requirementIds.has(inv.requirement), `invariant ${inv.id} cites unknown requirement ${inv.requirement}`);
  }
});

test('invariant ids are unique', () => {
  const ids = new Set(invariants.map((i) => i.id));
  assert.equal(ids.size, invariants.length, 'duplicate invariant ids');
});
