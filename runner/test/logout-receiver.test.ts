/**
 * TDD RED tests for the OIDC logout receiver + front-channel capture helpers.
 * These tests must fail before src/logout-receiver.ts and the helpers exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startLogoutReceiver, parseFrontchannelIframes } from '../src/logout-receiver.js';
import { frontchannelCapture, readLogoutToken } from '../src/logout-helpers.js';
import type { HelperContext } from '../src/runner.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address() as AddressInfo;
    resolve(`http://127.0.0.1:${address.port}`);
  }));
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
}

function postForm(url: string, form: string, contentType = 'application/x-www-form-urlencoded'): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({
      hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
      headers: { 'content-type': contentType, 'content-length': Buffer.byteLength(form) },
    }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end(form);
  });
}

function ctx(withArgs: Record<string, unknown>, extra: Partial<HelperContext> = {}): HelperContext {
  return { with: withArgs, scope: new Map(), send: async () => ({ status: 200, headers: {} }), ...extra } as HelperContext;
}

test('logout receiver captures a back-channel logout_token POST from the SUT', async () => {
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0 });
  try {
    const status = await postForm(receiver.url, new URLSearchParams({ logout_token: 'header.payload.signature' }).toString());
    assert.equal(status, 200);
    const captured = await receiver.waitForLogoutToken(2000);
    assert.equal(captured.logout_token, 'header.payload.signature');
    assert.equal(captured.content_type, 'application/x-www-form-urlencoded');
    assert.match(captured.received_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await receiver.close();
  }
});

test('logout receiver rejects non-form posts and never exposes them as logout tokens', async () => {
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0 });
  try {
    const status = await postForm(receiver.url, 'logout_token=x', 'application/json');
    assert.equal(status, 415);
    await assert.rejects(receiver.waitForLogoutToken(100), /timed out/);
  } finally {
    await receiver.close();
  }
});

test('logout receiver rejects posts without a logout_token parameter', async () => {
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0 });
  try {
    assert.equal(await postForm(receiver.url, 'other=value'), 400);
    await assert.rejects(receiver.waitForLogoutToken(100), /timed out/);
  } finally {
    await receiver.close();
  }
});

test('readLogoutToken helper returns a scoped, assertable response with the captured token', async () => {
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0 });
  try {
    await postForm(receiver.url, new URLSearchParams({ logout_token: 'a.b.c' }).toString());
    const response = await readLogoutToken(ctx({ waitMs: 1000 }, { logoutReceiver: receiver }));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { logout_token: 'a.b.c' });
  } finally {
    await receiver.close();
  }
});

test('readLogoutToken fails closed when no receiver is configured', async () => {
  await assert.rejects(readLogoutToken(ctx({})), /no back-channel logout receiver/);
});

test('parseFrontchannelIframes extracts only iframe srcs, decodes entities and ignores fragments', () => {
  const html = '<html><iframe src="https://rp.example/fc?iss=https%3A%2F%2Fop.example&amp;sid=abc" style="display:none"></iframe>'
    + '<iframe src=\'https://other.example/fc?x=1\'></iframe><iframe></iframe>'
    + '<img src="https://not-an-iframe.example/x"></html>';
  assert.deepEqual(parseFrontchannelIframes(html), [
    'https://rp.example/fc?iss=https%3A%2F%2Fop.example&sid=abc',
    'https://other.example/fc?x=1',
  ]);
});

test('frontchannelCapture helper parses iframe srcs from a captured HTML body variable', async () => {
  const scope = new Map([['logoutPage', '<iframe src="https://rp.example/fc?iss=op&amp;sid=s1"></iframe>']]);
  const response = await frontchannelCapture(ctx({ body: '{{logoutPage}}' }, { scope }));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { iframe_srcs: ['https://rp.example/fc?iss=op&sid=s1'] });
});

test('frontchannelCapture fails closed on a missing body variable', async () => {
  await assert.rejects(frontchannelCapture(ctx({ body: '{{missing}}' })), /unbound variable/);
});

// Verify the helper works through the real runner, not just direct calls.
test('runScenarios wires readLogoutToken into a stable scenario with real captured evidence', async () => {
  const { runScenarios } = await import('../src/runner.js');
  const receiver = await startLogoutReceiver({ host: '127.0.0.1', port: 0 });
  try {
    const scenario = {
      id: 'test.logout.backchannel', requirements: ['BCL-2.5-post-form-logout-token'], profile: 'oidc-basic', status: 'stable' as const,
      steps: [
        { id: 'trigger', use: 'read-logout-token', with: { waitMs: 1000 }, expect: { status: 200, json: { logout_token: 'x.y.z' } } },
      ],
    };
    const pending = runScenarios([scenario], {
      baseUrl: 'http://127.0.0.1:1', implementation: 'fake', contract: '0.1.0',
      helpers: { 'read-logout-token': (c) => readLogoutToken({ ...c, logoutReceiver: receiver }) },
    });
    await postForm(receiver.url, new URLSearchParams({ logout_token: 'x.y.z' }).toString());
    const report = await pending;
    assert.deepEqual(report.results[0]?.diffs, [], JSON.stringify(report.results[0]?.diffs));
    assert.equal(report.verdict, 'pass');
  } finally {
    await receiver.close();
  }
});

// Keep the local HTTP server helper referenced so lint does not flag unused imports.
test('reference listen helper binds a loopback port', async () => {
  const server = createServer((_req, res) => res.end('ok'));
  try {
    const url = await listen(server);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await close(server);
  }
});

test('parseSutConfig accepts a loopback logoutReceiver and rejects non-loopback, paths and unknown keys', async () => {
  const { parseSutConfig } = await import('../src/sut-runtime.js');
  const ok = await parseSutConfig('logoutReceiver:\n  origin: http://127.0.0.1:8099\n  path: /bc\n', '/tmp');
  assert.deepEqual(ok.logoutReceiver, { origin: 'http://127.0.0.1:8099', path: '/bc' });
  const defaulted = await parseSutConfig('logoutReceiver:\n  origin: http://localhost:8099\n', '/tmp');
  assert.equal(defaulted.logoutReceiver?.path, '/backchannel-logout');
  await assert.rejects(parseSutConfig('logoutReceiver:\n  origin: http://203.0.113.5:8099\n', '/tmp'), /loopback/);
  await assert.rejects(parseSutConfig('logoutReceiver:\n  origin: https://127.0.0.1:8099\n', '/tmp'), /http loopback/);
  await assert.rejects(parseSutConfig('logoutReceiver:\n  origin: http://127.0.0.1:8099\n  path: //evil\n', '/tmp'), /single \//);
  await assert.rejects(parseSutConfig('logoutReceiver:\n  origin: http://127.0.0.1:8099\n  extra: 1\n', '/tmp'), /unknown key "extra"/);
});

test('capture text.body returns the raw non-JSON response text and is accepted by the scenario parser', async () => {
  const { captureValue } = await import('../src/compare.js');
  const { parseScenario } = await import('../src/scenario.js');
  const page = '<iframe src="https://rp.example/fc"></iframe>';
  assert.equal(captureValue('text.body', { status: 200, headers: {}, body: undefined, text: page }), page);
  assert.equal(captureValue('text.body', { status: 200, headers: {}, body: {} }), undefined);
  const scenario = parseScenario({
    id: 'x.y.z', title: 't', requirements: ['R-1'], profile: 'oidc-basic', status: 'draft',
    steps: [{ id: 's', request: { method: 'GET', path: '/p' }, expect: { status: 200 }, capture: { page: 'text.body' } }],
  });
  assert.equal(scenario.steps[0]?.capture?.page, 'text.body');
});
