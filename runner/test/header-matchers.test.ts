/**
 * Header matchers: `expect.headers` values may be a non-empty matcher or a
 * regex, relaxing the otherwise exact-value header assertion for response
 * headers whose value is non-deterministic (DPoP-Nonce, WWW-Authenticate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareResponse, type ActualResponse } from '../src/compare.js';

function resp(headers: Record<string, string>): ActualResponse {
  return { status: 400, headers, body: { error: 'use_dpop_nonce' } };
}

test('$nonempty header matcher passes for a non-empty value', () => {
  const expect = { status: 400, headers: { 'dpop-nonce': { $nonempty: true } } } as never;
  assert.deepEqual(compareResponse(expect, resp({ 'dpop-nonce': 'abc123' })), []);
});

test('$nonempty header matcher fails when the header is empty or absent', () => {
  const expect = { status: 400, headers: { 'dpop-nonce': { $nonempty: true } } } as never;
  assert.equal(compareResponse(expect, resp({ 'dpop-nonce': '' })).length, 1);
  assert.equal(compareResponse(expect, resp({})).length, 1);
});

test('$regex header matcher passes when the value matches', () => {
  const expect = { status: 400, headers: { 'www-authenticate': { $regex: 'scope="[^"]+"' } } } as never;
  assert.deepEqual(compareResponse(expect, resp({ 'www-authenticate': 'Bearer error="insufficient_scope", scope="read write"' })), []);
});

test('$regex header matcher fails when the header is absent or does not match', () => {
  const expect = { status: 400, headers: { 'dpop-nonce': { $regex: '^[0-9a-f]{8}$' } } } as never;
  assert.equal(compareResponse(expect, resp({ 'dpop-nonce': 'xyz' })).length, 1);
  assert.equal(compareResponse(expect, resp({})).length, 1);
});

test('a literal header value still matches exactly (backward compatible)', () => {
  const expect = { status: 400, headers: { 'dpop-nonce': 'abc' } } as never;
  assert.deepEqual(compareResponse(expect, resp({ 'dpop-nonce': 'abc' })), []);
  assert.equal(compareResponse(expect, resp({ 'dpop-nonce': 'def' })).length, 1);
});