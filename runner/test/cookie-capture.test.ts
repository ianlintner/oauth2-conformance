/**
 * `cookie.first` capture source: selects the first `name=value` pair of the
 * `set-cookie` header so a scenario can replay a session cookie on a later
 * plain step (operations §4 social-login callback negatives). Not a cookie jar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureValue, firstCookiePair, type ActualResponse } from '../src/compare.js';
import { sendRequest } from '../src/http.js';
import { parseScenario, type Scenario } from '../src/scenario.js';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withHeaders(headers: Record<string, string>): ActualResponse {
  return { status: 302, headers, body: null };
}

test('cookie.first returns the name=value pair and drops attributes', () => {
  const actual = withHeaders({ 'set-cookie': 'id=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600' });
  assert.equal(captureValue('cookie.first', actual), 'id=abc123');
});

test('cookie.first returns a bare pair with no attributes unchanged', () => {
  assert.equal(captureValue('cookie.first', withHeaders({ 'set-cookie': 'id=abc123' })), 'id=abc123');
});

test('cookie.first looks the set-cookie header up case-insensitively', () => {
  assert.equal(captureValue('cookie.first', withHeaders({ 'Set-Cookie': 'sid=xyz; Secure' })), 'sid=xyz');
});

test('cookie.first keeps "=" inside the value (base64 session payloads)', () => {
  assert.equal(firstCookiePair({ 'set-cookie': 'id=YWJj+ZA==; Path=/' }), 'id=YWJj+ZA==');
});

test('cookie.first selects the first cookie from a real multi-Set-Cookie response', async () => {
  // Transport-level: Headers#forEach emits each Set-Cookie separately in
  // undici; http.ts must preserve all of them in a comma-joined header.
  const cases: [string, string][] = [
    ['id=first; Path=/; HttpOnly', 'id=first; Path=/; HttpOnly, other=second; Path=/'],
    ['id=first', 'id=first, other=second; Path=/'],
  ];
  for (const [first, expectedHeader] of cases) {
    const fetchImpl = (async () => {
      const h = new Headers({ location: 'https://idp.invalid/authorize?state=s1' });
      h.append('set-cookie', first);
      h.append('set-cookie', 'other=second; Path=/');
      return new Response(null, { status: 302, headers: h });
    }) as unknown as typeof fetch;
    const actual = await sendRequest(
      { method: 'GET', url: 'http://sut.invalid/login', headers: {} },
      { fetchImpl },
    );
    assert.equal(actual.headers['set-cookie'], expectedHeader);
    assert.equal(captureValue('cookie.first', actual), 'id=first');
  }
});

test('cookie.first is undefined when there is no set-cookie header', () => {
  assert.equal(captureValue('cookie.first', withHeaders({ location: '/x' })), undefined);
});

test('cookie.first is undefined for a malformed set-cookie without a name=value pair', () => {
  assert.equal(firstCookiePair({ 'set-cookie': 'HttpOnly; Path=/' }), undefined);
  assert.equal(firstCookiePair({ 'set-cookie': '=nameless; Path=/' }), undefined);
  assert.equal(firstCookiePair({ 'set-cookie': '' }), undefined);
});

test('cookie.<other> is not a capture source', () => {
  const actual = withHeaders({ 'set-cookie': 'id=abc' });
  assert.equal(captureValue('cookie.id', actual), undefined);
});

function scenarioWithCapture(expression: string): unknown {
  return {
    id: 'test.cookie.capture',
    requirements: ['R'],
    profile: 'operations',
    status: 'draft',
    steps: [{ id: 'login', request: { method: 'GET', path: '/x' }, expect: { status: 302 }, capture: { session: expression } }],
  };
}

test('parseScenario accepts cookie.first and rejects other cookie selectors', () => {
  const parsed = parseScenario(scenarioWithCapture('cookie.first'));
  assert.equal(parsed.steps[0]!.capture?.session, 'cookie.first');
  assert.throws(() => parseScenario(scenarioWithCapture('cookie.id')), /cookie\.first/);
  assert.throws(() => parseScenario(scenarioWithCapture('cookie.first.extra')), /must select/);
});

test('scenario schema capture pattern admits cookie.first only', async () => {
  const schema = JSON.parse(await readFile(path.join(runnerDir, '..', 'schemas', 'scenario.schema.json'), 'utf8')) as {
    $defs: { step: { properties: { capture: { additionalProperties: { pattern: string } } } } };
  };
  const pattern = new RegExp(schema.$defs.step.properties.capture.additionalProperties.pattern);
  assert.ok(pattern.test('cookie.first'));
  assert.ok(!pattern.test('cookie.id'));
  assert.ok(!pattern.test('cookie.first.x'));
});

test('runScenarios replays a cookie.first capture on a later step and fails when absent', async () => {
  const { runScenarios } = await import('../src/runner.js');
  const sentCookies: (string | undefined)[] = [];
  let setCookie = true;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url.includes('/login')) {
      const h = new Headers({ location: 'https://idp.invalid/authorize?state=s1' });
      if (setCookie) h.append('set-cookie', 'id=sess-1; Path=/; HttpOnly');
      return new Response(null, { status: 302, headers: h });
    }
    sentCookies.push(headers.get('cookie') ?? undefined);
    return new Response(JSON.stringify({ error: 'access_denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const scenario: Scenario = {
    id: 'test.cookie.replay',
    requirements: ['R'],
    profile: 'operations',
    status: 'stable',
    steps: [
      {
        id: 'login',
        request: { method: 'GET', path: '/login' },
        expect: { status: 302 },
        capture: { state: 'redirect.query.state', session: 'cookie.first' },
      },
      {
        id: 'callback',
        request: { method: 'GET', path: '/callback', headers: { cookie: '{{session}}' } },
        expect: { status: 403, json: { error: 'access_denied' } },
      },
    ],
  };
  const options = { baseUrl: 'http://sut.invalid', implementation: 'fake', contract: '0.6.0', fetchImpl };

  const ok = await runScenarios([scenario], options);
  assert.equal(ok.results[0]!.outcome, 'pass', JSON.stringify(ok.results[0]!.diffs));
  assert.deepEqual(sentCookies, ['id=sess-1']);

  setCookie = false;
  const missing = await runScenarios([scenario], options);
  assert.equal(missing.results[0]!.outcome, 'fail');
  assert.ok(missing.results[0]!.diffs.some((d) => d.path === 'login.capture.session'));
});
