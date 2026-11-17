/**
 * `expect.redirect.formEncodedQuery`: asserts the RAW Location query value is a
 * valid application/x-www-form-urlencoded serialization (RFC 6749 Appendix B)
 * that decodes to the expected string. Distinct from `redirect.query`, which
 * only compares the decoded value. Equivalent encodings (hex case, `~`) pass;
 * unencoded reserved characters fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareResponse, type ActualResponse } from '../src/compare.js';
import { parseExpectation } from '../src/scenario.js';

const ISS = 'https://as.example:8443/tenant';

function resp(location: string): ActualResponse {
  return { status: 302, headers: { location }, body: undefined };
}
const expectIss = (decoded = ISS) =>
  parseExpectation({ status: 302, redirect: { formEncodedQuery: { iss: decoded } } }, 'expect');

test('parseExpectation accepts redirect.formEncodedQuery', () => {
  assert.deepEqual(expectIss().redirect?.formEncodedQuery, { iss: ISS });
});

test('percent-encoded iss passes', () => {
  const loc = 'https://client.example/cb?code=c&iss=https%3A%2F%2Fas.example%3A8443%2Ftenant';
  assert.deepEqual(compareResponse(expectIss(), resp(loc)), []);
});

test('equivalent encoding (lowercase hex) passes', () => {
  const loc = 'https://client.example/cb?iss=https%3a%2f%2fas.example%3a8443%2ftenant&code=c';
  assert.deepEqual(compareResponse(expectIss(), resp(loc)), []);
});

test('raw (unencoded) reserved characters in iss fail', () => {
  const loc = `https://client.example/cb?code=c&iss=${ISS}`;
  const diffs = compareResponse(expectIss(), resp(loc));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.path, 'redirect.formEncodedQuery.iss');
  assert.match(diffs[0]?.reason ?? '', /not form-urlencoded/);
});

test('correctly encoded but wrong issuer fails', () => {
  const loc = 'https://client.example/cb?iss=https%3A%2F%2Fevil.example';
  const diffs = compareResponse(expectIss(), resp(loc));
  assert.equal(diffs.length, 1);
  assert.match(diffs[0]?.reason ?? '', /decodes to/);
});

test('missing iss fails', () => {
  const diffs = compareResponse(expectIss(), resp('https://client.example/cb?code=c'));
  assert.equal(diffs.length, 1);
  assert.match(diffs[0]?.reason ?? '', /missing/);
});

test('duplicate iss parameter fails', () => {
  const enc = 'https%3A%2F%2Fas.example%3A8443%2Ftenant';
  const diffs = compareResponse(expectIss(), resp(`https://client.example/cb?iss=${enc}&iss=${enc}`));
  assert.equal(diffs.length, 1);
  assert.match(diffs[0]?.reason ?? '', /more than once/);
});

test('malformed percent escape fails instead of throwing', () => {
  const diffs = compareResponse(expectIss(), resp('https://client.example/cb?iss=https%3A%2F%ZZ'));
  assert.equal(diffs.length, 1);
});

test('missing Location header fails', () => {
  const diffs = compareResponse(expectIss(), { status: 302, headers: {}, body: undefined });
  assert.equal(diffs.length, 1);
});

test('fragment iss is not read as the query value', () => {
  const diffs = compareResponse(expectIss(), resp('https://client.example/cb#iss=https%3A%2F%2Fas.example%3A8443%2Ftenant'));
  assert.equal(diffs.length, 1);
});

test('formEncodedQuery rejects non-string values at parse time', () => {
  assert.throws(() => parseExpectation({ status: 302, redirect: { formEncodedQuery: { iss: 1 } } }, 'expect'));
});
