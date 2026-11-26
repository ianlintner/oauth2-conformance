/**
 * Regression tests for the logout draft scenarios: each draft must be able to
 * pass against a fully compliant fake SUT. If the matchers or capture
 * expressions are wrong, a later promotion would hide the defect as a port
 * deviation. The runner and receiver are real; only the SUT HTTP responses are
 * faked with an injected fetch implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { runScenarios } from '../src/runner.js';
import { parseScenario } from '../src/scenario.js';
import { loginAndAuthorize } from '../src/helpers.js';
import { readLogoutToken, frontchannelCapture } from '../src/logout-helpers.js';
import { startLogoutReceiver } from '../src/logout-receiver.js';

const repository = path.resolve(import.meta.dirname, '../..');

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'logout+jwt' })}.${encode(payload)}.signature`;
}

const idToken = jwt({ iss: 'http://localhost:8080', sub: 'alice', aud: 'client-logout' });
const logoutToken = jwt({
  iss: 'http://localhost:8080', aud: 'client-logout', iat: 1795430000,
  jti: 'logout-jti-1', sid: 'sid-1',
  events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
});

async function loadScenario(name: string) {
  const text = await readFile(path.join(repository, 'scenarios/oidc-basic/logout', name), 'utf8');
  return parseScenario(parseYaml(text));
}

test('each logout draft can pass against a compliant fake SUT', async () => {
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0, path: '/backchannel-logout' });
  const names = [
    'backchannel-logout-token-claims.yaml',
    'frontchannel-logout-iframes.yaml',
    'post-logout-redirect-unregistered-rejected.yaml',
    'post-logout-redirect-state-echo.yaml',
  ];
  const unverifiableDraft = 'id-token-hint-aud.yaml';
  try {
    for (const name of names) {
      const scenario = await loadScenario(name);
      const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        if (url.pathname === '/oauth/authorize') {
          return new Response(null, { status: 302, headers: { location: 'https://client.example/callback?code=code-1&state=s-logout' } });
        }
        if (url.pathname === '/oauth/token') {
          return Response.json({ id_token: idToken });
        }
        if (url.pathname === '/oauth/logout') {
          const requested = url.searchParams.get('post_logout_redirect_uri');
          if (requested === 'https://client.example/logged-out/extra') {
            return Response.json({ error: 'invalid_request' }, { status: 400 });
          }
          if (requested !== null) {
            const location = new URL(requested);
            location.searchParams.set('state', url.searchParams.get('state') ?? '');
            return new Response(null, { status: 302, headers: { location: location.toString() } });
          }
          const form = new URLSearchParams({ logout_token: logoutToken }).toString();
          const target = new URL(receiver.url);
          await fetch(target, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
          return new Response('<iframe src="http://127.0.0.1:8099/frontchannel-logout?iss=op&amp;sid=sid-1"></iframe>', {
            status: 200, headers: { 'content-type': 'text/html' },
          });
        }
        // The receiver is a separate listener and uses the real fetch (not this fake).
        if (url.hostname === '127.0.0.1') return fetch(input, init);
        return new Response('not found', { status: 404 });
      };
      const report = await runScenarios([scenario], {
        baseUrl: 'http://localhost:8080', implementation: 'fake', contract: '0.1.0',
        fetchImpl: fakeFetch as typeof fetch,
        helpers: {
          'login-and-authorize': loginAndAuthorize,
          'read-logout-token': readLogoutToken,
          'frontchannel-capture': frontchannelCapture,
        },
        sut: { logoutReceiverInstance: receiver },
      });
      assert.deepEqual(
        report.results[0]?.diffs ?? [], [],
        `${name}: ${JSON.stringify(report.results[0]?.diffs)}`,
      );
    }
    // The foreign-audience draft is intentionally unfinished: it needs a
    // SUT-signed foreign-aud token fixture. Assert it fails closed rather than
    // silently passing, so it cannot be promoted as vacuous evidence.
    const draft = await loadScenario(unverifiableDraft);
    const report = await runScenarios([draft], {
      baseUrl: 'http://localhost:8080', implementation: 'fake', contract: '0.1.0',
      fetchImpl: (async () => Response.json({ error: 'invalid_request' }, { status: 400 })) as typeof fetch,
      helpers: {},
      sut: {},
    });
    assert.ok((report.results[0]?.diffs.length ?? 0) > 0, 'unfinished foreign-aud draft must not pass');
  } finally {
    await receiver.close();
  }
});
