/**
 * RFC 8252 7.3 loopback any-port: executable-evidence regression tests.
 *
 * A `status: 302` on an unauthenticated authorize is also what a login-page
 * redirect returns, so it cannot prove the registered loopback URI matched a
 * request carrying a different port. These tests pin the two runner pieces
 * that make the positive scenarios real evidence:
 *  - login-and-authorize must continue through the SUT's login redirect and
 *    return the final authorization redirect carrying the code;
 *  - `expect.redirect.locationPrefix` must reject a redirect that dropped or
 *    changed the wildcard port.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { compareResponse } from '../src/compare.js';
import { runScenarios } from '../src/runner.js';
import { loginAndAuthorize } from '../src/helpers.js';
import { parseExpectation, type Scenario } from '../src/scenario.js';

interface FakeSut {
  server: Server;
  url: string;
}

/** Seeded-SUT stand-in: unauthenticated authorize -> login redirect; login sets a cookie; authenticated authorize issues a code. */
async function fakeSut(options: { dropPort?: boolean } = {}): Promise<FakeSut> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sut.invalid');
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      res.writeHead(303, { 'set-cookie': 'sid=abc; Path=/', location: '/' });
      res.end();
      return;
    }
    if (url.pathname === '/oauth/authorize') {
      if (!(req.headers.cookie ?? '').includes('sid=abc')) {
        res.writeHead(302, { location: '/auth/login' });
        res.end();
        return;
      }
      const target = new URL(url.searchParams.get('redirect_uri') ?? '');
      if (options.dropPort === true) target.port = '';
      target.searchParams.set('code', 'code-123');
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: target.toString() });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const anyPortScenario = (): Scenario => ({
  id: 'test.native.any-port',
  requirements: ['RFC8252-7.3-loopback-ipv4-any-port'],
  profile: 'core',
  status: 'stable',
  steps: [
    {
      id: 'authorize',
      use: 'login-and-authorize',
      with: {
        username: 'alice',
        password: 'pw',
        loginPath: '/auth/login',
        authorizePath: '/oauth/authorize',
        query: { response_type: 'code', client_id: 'c', redirect_uri: 'http://127.0.0.1:9999/cb', state: 's-1' },
      },
      expect: { status: 302, redirect: { locationPrefix: 'http://127.0.0.1:9999/cb?', query: { state: 's-1' } } },
      capture: { code: 'redirect.query.code' },
    },
  ],
});

test('login-and-authorize continues past the login redirect and returns the code redirect', async () => {
  const { server, url } = await fakeSut();
  try {
    const report = await runScenarios([anyPortScenario()], { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.deepEqual(report.results[0]?.diffs, []);
    assert.equal(report.verdict, 'pass');
  } finally {
    server.close();
  }
});

test('an any-port scenario fails when the SUT redirects but drops the wildcard port', async () => {
  const { server, url } = await fakeSut({ dropPort: true });
  try {
    const report = await runScenarios([anyPortScenario()], { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.equal(report.verdict, 'fail');
    assert.ok(report.results[0]?.diffs.some((d) => d.path.endsWith('redirect.location')), JSON.stringify(report.results[0]?.diffs));
  } finally {
    server.close();
  }
});

test('login-and-authorize still returns an immediate redirect back to the client (no login required)', async () => {
  const sent: string[] = [];
  const response = await loginAndAuthorize({
    scope: new Map(),
    with: { username: 'a', password: 'b', authorizePath: '/oauth/authorize', query: { redirect_uri: 'https://client.example/cb' } },
    send: async (request) => {
      sent.push(`${request.method} ${request.url}`);
      return { status: 302, headers: { location: 'https://client.example/cb?code=x' }, body: undefined, redirect: { location: 'https://client.example/cb?code=x', query: { code: 'x' }, fragment: {} } };
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(response.redirect?.query.code, 'x');
});

test('locationPrefix: matching prefix passes, other host/port/path fails, missing Location fails', () => {
  const expect = parseExpectation({ status: 302, redirect: { locationPrefix: 'http://127.0.0.1:9999/cb?' } }, 'e');
  const ok = { status: 302, headers: { location: 'http://127.0.0.1:9999/cb?code=1' }, body: undefined };
  assert.deepEqual(compareResponse(expect, ok), []);
  for (const location of ['http://127.0.0.1/cb?code=1', 'http://127.0.0.1:9998/cb?code=1', 'http://127.0.0.1:9999/other?code=1']) {
    assert.equal(compareResponse(expect, { status: 302, headers: { location }, body: undefined }).length, 1, location);
  }
  assert.equal(compareResponse(expect, { status: 302, headers: {}, body: undefined }).length >= 1, true);
});

test('a helper (use:) step keeps its expect block through parsing, so its assertions are executed', async () => {
  const { parseScenario } = await import('../src/scenario.js');
  const parsed = parseScenario(anyPortScenario());
  const step = parsed.steps[0];
  assert.ok(step?.expect, 'expect on a use: step must survive parseScenario');
  assert.equal(step.expect.redirect?.locationPrefix, 'http://127.0.0.1:9999/cb?');
});
