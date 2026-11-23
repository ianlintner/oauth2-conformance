/**
 * RED-first regression tests for the second independent review of PR #41:
 *  - `$includes` on arrays must keep exact membership (no substring), so a
 *    stable `aud: {$includes: client-a}` assertion cannot pass on
 *    `["client-a-evil"]`;
 *  - `$regex` inside `expect.json` must match a string or an array member,
 *    so the front-channel iframe scenario can prefix-match `src` URIs
 *    without loosening `$includes`;
 *  - `redirectNot.location` must reject a forbidden redirect Location even
 *    when the status is not in `statusNot` (e.g. 301), and must require the
 *    endpoint to exist (a 404 from a SUT with no logout endpoint is not
 *    evidence of an RFC-conformant rejection).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareResponse } from '../src/compare.js';

test('$includes on an array requires exact membership, not a substring', () => {
  const expect = { status: 200, json: { aud: { $includes: 'client-a' } } } as never;
  assert.deepEqual(compareResponse(expect, { status: 200, headers: {}, body: { aud: ['client-a'] } }), []);
  const evil = compareResponse(expect, { status: 200, headers: {}, body: { aud: ['client-a-evil'] } });
  assert.equal(evil.length, 1);
  assert.equal(evil[0]!.path, 'aud');
  // The same rule protects the back-channel draft's aud assertion.
  const backchannel = { status: 200, json: { aud: { $includes: 'client-logout' } } } as never;
  assert.equal(compareResponse(backchannel, {
    status: 200, headers: {}, body: { aud: 'client-logout-idle' },
  }).length, 0, 'string $includes remains a substring check (pre-existing behavior)');
  assert.equal(compareResponse(backchannel, {
    status: 200, headers: {}, body: { aud: ['client-logout-idle'] },
  }).length, 1, 'array $includes must not accept client-logout-idle');
});

test('$regex in expect.json matches a string', () => {
  const expect = { status: 200, json: { iss: { $regex: '^https://op\\.example/' } } } as never;
  assert.deepEqual(compareResponse(expect, { status: 200, headers: {}, body: { iss: 'https://op.example/tenant' } }), []);
  assert.equal(compareResponse(expect, { status: 200, headers: {}, body: { iss: 'https://evil.example/' } }).length, 1);
});

test('$regex in expect.json matches an array member for iframe src prefix matching', () => {
  const expect = {
    status: 200,
    json: { iframe_srcs: { $regex: '^http://127\\.0\\.0\\.1:8099/frontchannel-logout' } },
  } as never;
  assert.deepEqual(compareResponse(expect, {
    status: 200, headers: {}, body: { iframe_srcs: ['http://127.0.0.1:8099/frontchannel-logout?iss=op&sid=sid-1'] },
  }), []);
  const diffs = compareResponse(expect, {
    status: 200, headers: {}, body: { iframe_srcs: ['http://evil.example/frontchannel-logout'] },
  });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]!.path, 'iframe_srcs');
});

test('redirectNot.location rejects a forbidden Location, including on 301', () => {
  const expect = {
    statusNot: [301, 302, 303, 307, 308],
    redirectNot: { location: 'https://client.example/logged-out/extra' },
  } as never;
  const forbidden = compareResponse(expect, {
    status: 301, headers: { location: 'https://client.example/logged-out/extra' }, body: {},
  });
  assert.ok(forbidden.some((d) => d.path === 'redirect.location'), JSON.stringify(forbidden));
  assert.deepEqual(compareResponse(expect, { status: 400, headers: {}, body: {} }), []);
  assert.deepEqual(compareResponse(expect, {
    status: 200, headers: { location: 'https://client.example/logged-out' }, body: {},
  }), []);
});
