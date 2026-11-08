/**
 * Duplicate-key form/query transport: `request.form` and `request.query`
 * accept an ordered list of name/value pairs alongside the existing string
 * map, preserving order and duplicate keys.
 *
 * RFC 6749 §3.1/§3.2 and RFC 8628 §3.1 forbid repeating a parameter; a server
 * must be able to distinguish "one client_id" from "two client_id values", so
 * the runner has to transmit duplicates, not collapse them in an object map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeForm } from '../src/http.js';
import { parseRequest, type Scenario } from '../src/scenario.js';

test('encodeForm preserves duplicate keys in order from a name/value pair list', () => {
  const body = encodeForm([
    { name: 'client_id', value: 'client-dev' },
    { name: 'client_id', value: 'client-dev' },
    { name: 'scope', value: 'read' },
  ]);
  assert.equal(body, 'client_id=client-dev&client_id=client-dev&scope=read');
});

test('encodeForm still encodes a plain string map', () => {
  assert.equal(encodeForm({ grant_type: 'client_credentials', scope: 'a b' }), 'grant_type=client_credentials&scope=a+b');
});

test('parseRequest accepts a name/value pair list for form and query', () => {
  const request = parseRequest(
    {
      method: 'POST',
      path: '/oauth/device_authorization',
      form: [{ name: 'scope', value: 'read' }, { name: 'scope', value: 'write' }],
      query: [{ name: 'dup', value: '1' }, { name: 'dup', value: '2' }],
    },
    'request',
  );
  assert.deepEqual(request.form, [{ name: 'scope', value: 'read' }, { name: 'scope', value: 'write' }]);
  assert.deepEqual(request.query, [{ name: 'dup', value: '1' }, { name: 'dup', value: '2' }]);
});

test('parseRequest rejects a name/value list entry lacking name or value', () => {
  assert.throws(() => parseRequest({ method: 'POST', path: '/x', form: [{ name: 'a' }] }, 'request'), /name and value/);
  assert.throws(() => parseRequest({ method: 'POST', path: '/x', form: [{ value: 'b' }] }, 'request'), /name and value/);
  assert.throws(() => parseRequest({ method: 'POST', path: '/x', form: [{}] }, 'request'), /name and value/);
  assert.throws(() => parseRequest({ method: 'POST', path: '/x', form: [] }, 'request'), /nonempty/);
});

test('runScenarios preserves duplicate query names in order and resolves captured-value templates', async () => {
  const { runScenarios } = await import('../src/runner.js');
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify({ code: 'captured-code' }), {
      status: 302,
      headers: { 'content-type': 'application/json', location: '/oauth/token?code=captured-code' },
    });
  }) as unknown as typeof fetch;

  const scenario: Scenario = {
    id: 'test.dup.query',
    requirements: ['R'],
    profile: 'core',
    status: 'stable',
    steps: [
      {
        id: 'authorize',
        request: { method: 'GET', path: '/oauth/authorize', query: { client_id: 'client' } },
        expect: { status: 302 },
        capture: { code: 'redirect.query.code' },
      },
      {
        id: 'token',
        request: {
          method: 'POST',
          path: '/oauth/token',
          query: [
            { name: 'code', value: '{{code}}' },
            { name: 'dup', value: '1' },
            { name: 'dup', value: '2' },
          ],
          headers: { authorization: 'Basic abc' },
        },
        expect: { status: 302 },
      },
    ],
  };

  const report = await runScenarios([scenario], {
    baseUrl: 'http://sut.invalid',
    implementation: 'fake',
    contract: '0.1.0',
    fetchImpl,
  });

  assert.equal(report.results[0]!.outcome, 'pass');
  assert.equal(seen.length, 2);
  assert.equal(
    seen[1],
    'http://sut.invalid/oauth/token?code=captured-code&dup=1&dup=2',
    'duplicate query keys must be preserved, in order, with captured values resolved',
  );
});