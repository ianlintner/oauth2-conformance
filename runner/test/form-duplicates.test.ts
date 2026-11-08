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
import { parseRequest } from '../src/scenario.js';

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