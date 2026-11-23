import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareResponse } from '../src/compare.js';

test('$nonempty accepts non-empty strings, arrays and objects', () => {
  assert.deepEqual(compareResponse(
    { status: 200, json: { token: { $nonempty: true }, list: { $nonempty: true }, obj: { $nonempty: true } } },
    { status: 200, headers: {}, body: { token: 'abc', list: ['x'], obj: { key: {} } } },
  ), []);
});

test('$nonempty rejects empty strings, arrays and objects', () => {
  const diffs = compareResponse(
    { status: 200, json: { token: { $nonempty: true }, list: { $nonempty: true }, obj: { $nonempty: true } } },
    { status: 200, headers: {}, body: { token: '', list: [], obj: {} } },
  );
  assert.deepEqual(diffs.map((d) => d.path), ['token', 'list', 'obj']);
});

test('$present asserts key presence regardless of value', () => {
  assert.deepEqual(compareResponse(
    { status: 200, json: { events: { 'http://schemas.openid.net/event/backchannel-logout': { $present: true } } } },
    { status: 200, headers: {}, body: { events: { 'http://schemas.openid.net/event/backchannel-logout': {} } } },
  ), []);
  const diffs = compareResponse(
    { status: 200, json: { events: { missing: { $present: true } } } },
    { status: 200, headers: {}, body: { events: {} } },
  );
  assert.deepEqual(diffs.map((d) => d.reason), ['required field absent']);
});

test('$includes on an array requires exact membership', () => {
  assert.deepEqual(compareResponse(
    { status: 200, json: { aud: { $includes: 'http://127.0.0.1:8099/frontchannel-logout' } } },
    { status: 200, headers: {}, body: { aud: ['http://127.0.0.1:8099/frontchannel-logout'] } },
  ), []);
  const diffs = compareResponse(
    { status: 200, json: { aud: { $includes: 'client-a' } } },
    { status: 200, headers: {}, body: { aud: ['client-a-evil'] } },
  );
  assert.deepEqual(diffs.map((d) => d.reason), ['array does not contain the expected value']);
});

test('$regex in expect.json prefix-matches an iframe src array member', () => {
  assert.deepEqual(compareResponse(
    { status: 200, json: { iframe_srcs: { $regex: '^http://127\\.0\\.0\\.1:8099/frontchannel-logout' } } },
    { status: 200, headers: {}, body: { iframe_srcs: ['http://127.0.0.1:8099/frontchannel-logout?sid=s1'] } },
  ), []);
  const diffs = compareResponse(
    { status: 200, json: { iframe_srcs: { $regex: '^http://127\\.0\\.0\\.1:8099/frontchannel-logout' } } },
    { status: 200, headers: {}, body: { iframe_srcs: ['http://evil.example/frontchannel-logout'] } },
  );
  assert.deepEqual(diffs.map((d) => d.reason), ['no array member matches the expected regex']);
});
