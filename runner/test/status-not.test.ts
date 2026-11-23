import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareResponse } from '../src/compare.js';

test('statusNot rejects only the listed redirect statuses', () => {
  const expect = { statusNot: [302, 303, 307, 308] } as never;
  assert.deepEqual(compareResponse(expect, { status: 200, headers: {}, body: {} }), []);
  assert.deepEqual(compareResponse(expect, { status: 400, headers: {}, body: {} }), []);
  const diffs = compareResponse(expect, { status: 302, headers: { location: 'https://evil.example' }, body: {} });
  assert.deepEqual(diffs.map((d) => d.reason), ['status is forbidden']);
});
