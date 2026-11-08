/**
 * Bounded step repetition: a step may declare `repeat: { count: N }` to replay
 * its request N times, asserting `expect` against every iteration. This lets a
 * scenario drive a rate-limit bucket to its limit (RFC 9700 §2.5) instead of a
 * single placeholder attempt that never reaches it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseScenario, MAX_REPEAT } from '../src/scenario.js';

function scenarioWithRepeat(count: unknown) {
  return parseScenario({
    id: 'sender-constrained.abuse.invalid-client-rate-limited',
    requirements: ['RFC9700-2.5-invalid-client-rate-limited-policy'],
    profile: 'sender-constrained',
    status: 'draft',
    steps: [
      { id: 'bad', repeat: { count }, request: { method: 'POST', path: '/oauth/token', form: { grant_type: 'client_credentials' } }, expect: { status: 401 } },
    ],
  });
}

test('parseScenario accepts a positive integer repeat count', () => {
  assert.equal(scenarioWithRepeat(10).steps[0]!.repeat, 10);
});

test('repeat rejects a non-positive, non-integer, or excessive count', () => {
  assert.throws(() => scenarioWithRepeat(0), /count/);
  assert.throws(() => scenarioWithRepeat(-1), /count/);
  assert.throws(() => scenarioWithRepeat(1.5), /count/);
  assert.throws(() => scenarioWithRepeat('10'), /count/);
  assert.throws(() => scenarioWithRepeat(MAX_REPEAT + 1), /count/);
});

test('repeat count at the bound is accepted', () => {
  assert.equal(scenarioWithRepeat(MAX_REPEAT).steps[0]!.repeat, MAX_REPEAT);
});