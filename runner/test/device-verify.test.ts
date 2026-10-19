import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceVerify } from '../src/helpers.js';
import type { HelperContext } from '../src/runner.js';

function ctx(withArgs: Record<string, unknown>, sent: Array<{ url: string; body?: string; headers: Record<string, string> }>): HelperContext {
  return {
    with: withArgs,
    scope: new Map([['uc', 'ABCD-EFGH']]),
    send: async (req: { url: string; body?: string; headers: Record<string, string> }) => {
      sent.push(req);
      return { status: 200, headers: req.url === '/login' ? { 'set-cookie': 'sid=1; Path=/' } : {} };
    },
  } as unknown as HelperContext;
}

test('device-verify logs in then submits the interpolated user_code with the action', async () => {
  const sent: Array<{ url: string; body?: string; headers: Record<string, string> }> = [];
  await deviceVerify(ctx({ username: 'alice', password: 'pw', user_code: '{{uc}}', action: 'deny' }, sent));
  assert.equal(sent[0]?.url, '/login');
  assert.equal(sent[1]?.url, '/oauth/device/verify');
  assert.equal(sent[1]?.headers.cookie, 'sid=1');
  assert.equal(new URLSearchParams(sent[1]?.body).get('user_code'), 'ABCD-EFGH');
  assert.equal(new URLSearchParams(sent[1]?.body).get('action'), 'deny');
});

test('device-verify rejects an unknown action', async () => {
  await assert.rejects(deviceVerify(ctx({ username: 'a', password: 'b', user_code: 'x', action: 'maybe' }, [])), /approve or deny/);
});
