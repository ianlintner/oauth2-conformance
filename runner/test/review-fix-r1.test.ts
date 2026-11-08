/**
 * Regression tests for the five review findings on PR #23 (round 1):
 *   - a step exception must stop later steps in the same scenario but not the run;
 *   - `__proto__` header names must stay their own assertion;
 *   - invalid `$regex` patterns must fail at load time, not during compare;
 *   - empty-string exact header expectations must remain valid literals;
 *   - `repeat` is only valid on request steps, never helper/assert steps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runScenarios } from '../src/runner.js';
import { parseExpectation, parseScenario, type Scenario } from '../src/scenario.js';

test('a step exception stops later steps in the same scenario but not the whole run', async () => {
  let sends = 0;
  const fetchImpl = (async () => {
    sends += 1;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const first: Scenario = {
    id: 'test.review.broken',
    requirements: ['R'],
    profile: 'core',
    status: 'stable',
    steps: [
      { id: 'boom', use: 'no-such-helper', expect: { status: 200 } },
      { id: 'after', request: { method: 'GET', path: '/after' }, expect: { status: 200 } },
    ],
  };
  const second: Scenario = {
    id: 'test.review.later',
    requirements: ['R'],
    profile: 'core',
    status: 'stable',
    steps: [{ id: 'ok', request: { method: 'GET', path: '/ok' }, expect: { status: 200 } }],
  };

  const report = await runScenarios([first, second], {
    baseUrl: 'http://sut.invalid',
    implementation: 'fake',
    contract: '0.1.0',
    fetchImpl,
    helpers: {},
  });

  assert.match(report.results[0]?.error ?? '', /no-such-helper/);
  assert.equal(sends, 1, 'the second step of the broken scenario must not send a request');
  assert.equal(report.results.length, 2, 'subsequent scenarios must still run');
  assert.equal(report.results[1]?.outcome, 'pass');
});

test('parseExpectation keeps a __proto__ header name as its own assertion', () => {
  const input = JSON.parse('{"status":400,"headers":{"__proto__":"x"}}');
  const expect = parseExpectation(input, 'e');
  const headers = expect.headers as Record<string, string>;
  assert.ok(Object.hasOwn(headers, '__proto__'), '__proto__ must become an own header key');
  assert.equal(headers['__proto__'], 'x');
});

test('parseExpectation rejects an invalid $regex pattern at load time', () => {
  assert.throws(
    () => parseExpectation({ status: 400, headers: { 'www-authenticate': { $regex: '[' } } }, 'e'),
    /regex/i,
  );
});

test('parseExpectation accepts an empty-string exact header value (string-type-only literal validation)', () => {
  const expect = parseExpectation({ status: 400, headers: { 'x-test': '' } }, 'e');
  const headers = expect.headers as Record<string, string>;
  assert.equal(headers['x-test'], '');
});

test('parseScenario rejects repeat on a helper (use) step', () => {
  assert.throws(
    () =>
      parseScenario({
        id: 'core.review.helper-repeat',
        requirements: ['R'],
        profile: 'core',
        status: 'draft',
        steps: [{ id: 'h', use: 'logout', repeat: { count: 100 } }],
      }),
    /repeat/,
  );
});

test('parseScenario rejects repeat on an assert-only step', () => {
  assert.throws(
    () =>
      parseScenario({
        id: 'core.review.assert-repeat',
        requirements: ['R'],
        profile: 'core',
        status: 'draft',
        steps: [{ id: 'a', assert: { status: 400, json: { error: 'x' } }, repeat: { count: 2 } }],
      }),
    /repeat/,
  );
});