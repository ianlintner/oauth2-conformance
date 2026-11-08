/**
 * Regression test for the single review finding on PR #23 (round 2):
 *   - the `repeat` schema guard only required `request`, so a step carrying
 *     `use`, a valid `request`, and `repeat` passed schema validation while
 *     `parseStep` rejected it (it forbids `use` + `request`). The guard must
 *     forbid `use` (and `assert`) so schema validation agrees with the loader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocument, loadValidators } from '../src/schema-validate.js';
import { parseScenario } from '../src/scenario.js';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(runnerDir, '..');

let validators: Awaited<ReturnType<typeof loadValidators>> | undefined;

function stepBase(overrides: Record<string, unknown>) {
  return {
    id: 'core.review.repeat-guard',
    requirements: ['RFC6749-5.2-invalid-client'],
    profile: 'core',
    status: 'draft',
    steps: [overrides],
  };
}

test('schema rejects a repeat guard on a use + request step (agrees with parseStep)', async () => {
  validators ??= await loadValidators(path.join(repoRoot, 'schemas'));

  const usePlusRequestPlusRepeat = stepBase({
    id: 'h',
    use: 'logout',
    request: { method: 'POST', path: '/oauth/token', form: { grant_type: 'client_credentials' } },
    repeat: { count: 2 },
  });

  // parseStep rejects it: use cannot be combined with request (and repeat).
  assert.throws(() => parseScenario(usePlusRequestPlusRepeat), /use and request/);

  // The schema must now agree: forbid use (and assert) under repeat.
  const violations = checkDocument(validators, 'scenario', usePlusRequestPlusRepeat);
  assert.notEqual(
    violations.length,
    0,
    'schema must reject use + request + repeat, not leave it to the loader',
  );
});

test('schema rejects a repeat guard on a use-only step', async () => {
  validators ??= await loadValidators(path.join(repoRoot, 'schemas'));

  const useOnlyWithRepeat = stepBase({ id: 'h', use: 'logout', repeat: { count: 2 } });
  assert.throws(() => parseScenario(useOnlyWithRepeat), /repeat on a use step/);
  assert.notEqual(
    checkDocument(validators, 'scenario', useOnlyWithRepeat).length,
    0,
    'schema must reject repeat on a use step',
  );
});

test('schema still accepts a well-formed repeat on a request step', async () => {
  validators ??= await loadValidators(path.join(repoRoot, 'schemas'));

  const requestOnlyWithRepeat = stepBase({
    id: 'r',
    request: { method: 'POST', path: '/oauth/token', form: { grant_type: 'client_credentials' } },
    expect: { status: 401 },
    repeat: { count: 2 },
  });
  assert.deepEqual(checkDocument(validators, 'scenario', requestOnlyWithRepeat), []);
});