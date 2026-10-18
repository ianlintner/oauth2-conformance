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
async function fakeSut(options: { dropPort?: boolean; maxLogins?: number; logins?: { count: number } } = {}): Promise<FakeSut> {
  const logins = options.logins ?? { count: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sut.invalid');
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      logins.count += 1;
      if (options.maxLogins !== undefined && logins.count > options.maxLogins) {
        res.writeHead(303, { location: '/auth/login?error=too_many_attempts' });
        res.end();
        return;
      }
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

test('login-and-authorize logs in once per user per run and reuses the session (SUT login rate limits)', async () => {
  const logins = { count: 0 };
  const { server, url } = await fakeSut({ maxLogins: 2, logins });
  try {
    const scenarios = Array.from({ length: 6 }, (_v, i) => ({ ...anyPortScenario(), id: `test.native.any-port-${i}` }));
    const report = await runScenarios(scenarios, { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.equal(report.passed, 6, JSON.stringify(report.results.map((r) => r.diffs)));
    assert.equal(logins.count, 1);
  } finally {
    server.close();
  }
});

/** Scripted SUT for direct helper calls: cookie `sid=<user>` is valid only if listed in `valid`. */
function scriptedSend(valid: Set<string>, log: string[]) {
  return async (request: { method: string; url: string; headers?: Record<string, string>; body?: string }) => {
    log.push(`${request.method} ${request.url}`);
    if (request.method === 'POST') {
      const user = new URLSearchParams(request.body ?? '').get('username') ?? '';
      return { status: 303, headers: { 'set-cookie': `sid=${user}; Path=/`, location: '/' }, body: undefined, redirect: { location: '/', query: {}, fragment: {} } };
    }
    const cookie = request.headers?.cookie ?? '';
    if (![...valid].some((sid) => cookie === sid)) {
      return { status: 302, headers: { location: '/auth/login' }, body: undefined, redirect: { location: '/auth/login', query: {}, fragment: {} } };
    }
    const location = 'https://client.example/cb?code=x';
    return { status: 302, headers: { location }, body: undefined, redirect: { location, query: { code: 'x' }, fragment: {} } };
  };
}

const helperWith = (password: string) => ({ username: 'alice', password, loginPath: '/auth/login', authorizePath: '/oauth/authorize', query: { redirect_uri: 'https://client.example/cb' } });

test('login-and-authorize does not reuse a session across different passwords for the same user', async () => {
  const log: string[] = [];
  const sessions = new Map<string, string>();
  const send = scriptedSend(new Set(['sid=alice']), log);
  await loginAndAuthorize({ scope: new Map(), with: helperWith('good'), send, sessions });
  await loginAndAuthorize({ scope: new Map(), with: helperWith('other'), send, sessions });
  assert.equal(log.filter((entry) => entry.startsWith('POST')).length, 2, log.join(' | '));
});

test('login-and-authorize logs in again when the cached session is stale', async () => {
  const log: string[] = [];
  const sessions = new Map<string, string>();
  const valid = new Set(['sid=alice']);
  const send = scriptedSend(valid, log);
  await loginAndAuthorize({ scope: new Map(), with: helperWith('good'), send, sessions });
  const stale = [...sessions.keys()][0] as string;
  sessions.set(stale, 'sid=expired');
  const response = await loginAndAuthorize({ scope: new Map(), with: helperWith('good'), send, sessions });
  assert.equal(response.redirect?.query.code, 'x');
  assert.equal(log.filter((entry) => entry.startsWith('POST')).length, 2, log.join(' | '));
});

test('login-and-authorize fails loudly when the login step itself is refused (never returns a code-less redirect as success)', async () => {
  const { server, url } = await fakeSut({ maxLogins: 0 });
  try {
    const report = await runScenarios([anyPortScenario()], { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.equal(report.failed, 1);
    assert.match(report.results[0]?.error ?? '', /too_many_attempts/);
  } finally {
    server.close();
  }
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
