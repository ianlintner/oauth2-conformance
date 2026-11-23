/**
 * TDD tests for prompt=login re-authentication evidence:
 * a stable scenario must FAIL against a SUT that ignores prompt=login when a
 * session is already active. Two-step: establish session, then reuse the
 * cookie with prompt=login and assert the login redirect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runScenarios } from '../src/runner.js';
import { loginAndAuthorize } from '../src/helpers.js';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { parseScenario, type Scenario } from '../src/scenario.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarioPath = path.resolve(runnerDir, '..', 'scenarios/oidc-basic/prompt/prompt-login-reauthenticates.yaml');

/** Load the real published scenario so the test scores scenario data, not a copy. */
async function checkScenario(): Promise<Scenario> {
  return parseScenario(parseYaml(await readFile(scenarioPath, 'utf8')));
}

function fakeSut(honorsPromptLogin: boolean): Promise<{ server: Server; url: string; logins: { count: number } }> {
  const logins = { count: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sut.invalid');
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      logins.count += 1;
      // Real SUTs replay the (re-auth-param-stripped) authorize URL after login.
      const replay = new URL('/oauth/authorize', 'http://sut.invalid');
      replay.searchParams.set('response_type', 'code');
      replay.searchParams.set('client_id', 'c');
      replay.searchParams.set('redirect_uri', 'https://client.example/callback');
      replay.searchParams.set('state', 's-prompt-login-session');
      res.writeHead(303, { 'set-cookie': `sid=session-${logins.count}; Path=/`, location: `${replay.pathname}${replay.search}` });
      res.end();
      return;
    }
    if (url.pathname === '/oauth/authorize') {
      const cookie = req.headers.cookie ?? '';
      const authed = cookie.startsWith('sid=session-');
      const forceLogin = authed && honorsPromptLogin && url.searchParams.get('prompt') === 'login';
      if (!authed || forceLogin) {
        res.writeHead(302, { location: '/auth/login' });
        res.end();
        return;
      }
      const target = new URL(url.searchParams.get('redirect_uri') ?? '');
      target.searchParams.set('code', 'ok');
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: target.toString() });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, logins })));
}

test('two-step prompt=login passes when the SUT forces re-authentication on an active session', async () => {
  const { server, url } = await fakeSut(true);
  try {
    const report = await runScenarios([await checkScenario()], { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.deepEqual(report.results[0]?.diffs, [], JSON.stringify(report.results[0]?.diffs));
    assert.equal(report.verdict, 'pass');
  } finally {
    server.close();
  }
});

test('two-step prompt=login FAILS when the SUT ignores prompt=login with an active session', async () => {
  const { server, url } = await fakeSut(false);
  try {
    const report = await runScenarios([await checkScenario()], { baseUrl: url, implementation: 'fake', contract: '0.1.0', helpers: { 'login-and-authorize': loginAndAuthorize } });
    assert.equal(report.verdict, 'fail');
    assert.ok(report.results[0]?.diffs.some((d) => d.path.includes('reauthenticate.redirect.location')), JSON.stringify(report.results[0]?.diffs));
  } finally {
    server.close();
  }
});
