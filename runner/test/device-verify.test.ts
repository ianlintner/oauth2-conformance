import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceVerify } from '../src/helpers.js';
import type { HelperContext } from '../src/runner.js';

type Sent = { method: string; url: string; body?: string; headers: Record<string, string> };

function ctx(withArgs: Record<string, unknown>, sent: Sent[], page: { status?: number; text?: string } = {}): HelperContext {
  return {
    with: withArgs,
    scope: new Map([['uc', 'ABCD-EFGH']]),
    send: async (req: Sent) => {
      sent.push(req);
      if (req.method === 'GET') return { status: page.status ?? 200, headers: {}, body: undefined, text: page.text ?? '' };
      return { status: 200, headers: req.url === '/login' ? { 'set-cookie': 'sid=1; Path=/' } : {} };
    },
  } as unknown as HelperContext;
}

const args = { username: 'alice', password: 'pw', user_code: '{{uc}}' };

test('device-verify logs in then submits the interpolated user_code with the action', async () => {
  const sent: Sent[] = [];
  await deviceVerify(ctx({ ...args, action: 'deny' }, sent));
  assert.equal(sent[0]?.url, '/login');
  assert.equal(sent[1]?.method, 'GET');
  assert.equal(sent[1]?.url, '/oauth/device/verify?user_code=ABCD-EFGH');
  assert.equal(sent[1]?.headers.cookie, 'sid=1');
  assert.equal(sent[2]?.url, '/oauth/device/verify');
  assert.equal(sent[2]?.headers.cookie, 'sid=1');
  assert.equal(new URLSearchParams(sent[2]?.body).get('user_code'), 'ABCD-EFGH');
  assert.equal(new URLSearchParams(sent[2]?.body).get('action'), 'deny');
});

test('device-verify echoes hidden inputs from the verification page', async () => {
  const sent: Sent[] = [];
  const text = `<form method="post">
    <input type="hidden" name="user_code" value="ABCD-EFGH">
    <input value="a&amp;b &quot;x&quot;" name="client_id" type='hidden'>
    <input type="hidden" name="csrf_token" value="tok&#43;1=">
    <input type="text" name="visible" value="no">
  </form>`;
  await deviceVerify(ctx(args, sent, { text }));
  const body = new URLSearchParams(sent[2]?.body);
  assert.equal(body.get('csrf_token'), 'tok+1=');
  assert.equal(body.get('client_id'), 'a&b "x"');
  assert.equal(body.get('action'), 'approve');
  assert.equal(body.getAll('user_code').length, 1);
  assert.equal(body.has('visible'), false);
  assert.equal(sent[2]?.headers['content-type'], 'application/x-www-form-urlencoded');
});

test('device-verify posts exactly user_code and action when the page has no hidden inputs', async () => {
  const sent: Sent[] = [];
  await deviceVerify(ctx(args, sent, { text: '<form><input type="text" name="user_code"></form>' }));
  assert.equal(sent[2]?.body, new URLSearchParams({ user_code: 'ABCD-EFGH', action: 'approve' }).toString());
});

test('device-verify throws when the verification page returns an error status', async () => {
  const sent: Sent[] = [];
  await assert.rejects(deviceVerify(ctx(args, sent, { status: 404 })), /verification page returned status 404/);
  assert.equal(sent.length, 2);
});

test('device-verify rejects an unknown action', async () => {
  await assert.rejects(deviceVerify(ctx({ username: 'a', password: 'b', user_code: 'x', action: 'maybe' }, [])), /approve or deny/);
});
