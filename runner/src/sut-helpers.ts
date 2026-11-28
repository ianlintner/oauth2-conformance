/**
 * SUT interface v2 step helpers (contract/sut-interface.md section 7).
 *
 * - `advance-clock`        POST the SUT's conformance clock endpoint.
 * - `sut-restart`          run the harness restart command, then wait for readiness.
 * - `request-on-instance`  send one request to a named SUT instance.
 * - `mtls-request`         send one request over TLS with a selected client cert.
 * - `x5t-s256`             RFC 8705 certificate thumbprint.
 *
 * Every helper fails closed: an unconfigured capability or a non-2xx answer from
 * a control endpoint throws, so the scenario fails (deferred while it is `draft`)
 * rather than continuing against a SUT whose state was not actually changed.
 */

import { execFile } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { interpolate, parsePath } from './scenario.js';
import { encodeForm, resolveUrl, sendRequest, toActualResponse } from './http.js';
import { x5tS256, type MtlsClientCert, type SutRuntime } from './sut-runtime.js';
import type { ActualResponse } from './compare.js';
import type { HelperContext } from './runner.js';

/** Upper bound for one clock advance: a year, so a typo cannot silently expire everything forever. */
export const MAX_CLOCK_ADVANCE_SECONDS = 365 * 86_400;
const DEFAULT_CLOCK_PATH = '/conformance/clock';

function sub(context: HelperContext, value: string): string {
  return interpolate(value, context.scope);
}

function localPath(helper: string, value: unknown): string {
  try {
    return parsePath(value, helper);
  } catch {
    throw new Error(`${helper}: with.path must start with / and be local to the server`);
  }
}

interface BuiltRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** Shared `with` -> request mapping for `request-on-instance` and `mtls-request`. */
function buildRequest(helper: string, context: HelperContext): BuiltRequest {
  const w = context.with;
  const method = typeof w.method === 'string' ? w.method.toUpperCase() : 'GET';
  if (!/^[A-Z]+$/.test(method)) throw new Error(`${helper}: with.method must be an HTTP method`);
  let requestPath = localPath(helper, w.path);
  if (w.query !== undefined) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(requireStringMap(helper, 'query', w.query))) query.append(key, sub(context, value));
    requestPath += `${requestPath.includes('?') ? '&' : '?'}${query.toString()}`;
  }
  const headers: Record<string, string> = {};
  if (w.headers !== undefined) {
    for (const [key, value] of Object.entries(requireStringMap(helper, 'headers', w.headers))) headers[key.toLowerCase()] = sub(context, value);
  }
  if (w.form !== undefined && w.json !== undefined) throw new Error(`${helper}: with.form and with.json are mutually exclusive`);
  let body: string | undefined;
  if (w.form !== undefined) {
    const form = requireStringMap(helper, 'form', w.form);
    body = encodeForm(Object.entries(form).map(([name, value]) => ({ name, value: sub(context, value) })));
    headers['content-type'] ??= 'application/x-www-form-urlencoded';
  } else if (w.json !== undefined) {
    if (typeof w.json !== 'object' || w.json === null || Array.isArray(w.json)) throw new Error(`${helper}: with.json must be an object`);
    body = sub(context, JSON.stringify(w.json));
    headers['content-type'] ??= 'application/json';
  }
  return { method, path: requestPath, headers, ...(body !== undefined ? { body } : {}) };
}

function requireStringMap(helper: string, name: string, value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.values(value).some((v) => typeof v !== 'string')) {
    throw new Error(`${helper}: with.${name} must be a map of strings`);
  }
  return value as Record<string, string>;
}

/** `use: advance-clock` — `with.seconds` (integer, may use `{{var}}`), optional `clockPath`. */
export async function advanceClock(context: HelperContext): Promise<ActualResponse> {
  const raw = context.with.seconds;
  // Validate the *substituted* string as plain ASCII decimal digits: Number() would
  // accept '', whitespace ('0'), '1e3' and '0x10'.
  const value = typeof raw === 'string' ? (/^[0-9]+$/.test(sub(context, raw)) ? Number(sub(context, raw)) : Number.NaN) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_CLOCK_ADVANCE_SECONDS) {
    throw new Error(`advance-clock: with.seconds must be an integer between 0 and ${MAX_CLOCK_ADVANCE_SECONDS}`);
  }
  const clockPath = context.with.clockPath === undefined ? DEFAULT_CLOCK_PATH : localPath('advance-clock', context.with.clockPath);
  const response = await context.send({
    method: 'POST',
    url: clockPath,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ advance_seconds: value }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`advance-clock: SUT answered ${response.status}; the test-clock capability is unavailable or conformance mode is off`);
  }
  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_NONCE_PATH = '/conformance/dpop-nonce';

/**
 * `dpop-nonce-mode`: POST /conformance/dpop-nonce {required: boolean}.
 * Fails closed on a non-boolean input or a non-2xx answer, so a SUT without
 * the capability cannot make a nonce scenario pass vacuously (contract §7.3/7.7).
 */
export async function dpopNonceMode(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const raw = context.with.required;
  let required: boolean;
  if (typeof raw === 'boolean') {
    required = raw;
  } else if (typeof raw === 'string') {
    const value = interpolate(raw, context.scope);
    if (value === 'true') required = true;
    else if (value === 'false') required = false;
    else throw new Error('dpop-nonce-mode: with.required must be a boolean or {{var}} resolving to true/false');
  } else {
    throw new Error('dpop-nonce-mode: with.required must be a boolean or {{var}} resolving to true/false');
  }
  const path = context.with.path === undefined
    ? DEFAULT_NONCE_PATH
    : localPath('dpop-nonce-mode', sub(context, String(context.with.path)));
  const response = await context.send({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ required }),
  });
  if (response.status < 200 || response.status > 299) {
    throw new Error(`dpop-nonce-mode: SUT answered ${response.status} to ${path}`);
  }
  return response;
}

/**
 * `storage-fault`: POST /conformance/storage-fault {"enabled": boolean}.
 *
 * Chosen over a harness restart/fault command because the existing control
 * endpoints (test-clock, dpop-nonce-mode) already define the shape: a boolean
 * toggle, process-local, reset on restart, refused outside conformance mode.
 * The SUT's own /ready probe observes the injected fault, so the harness never
 * has to fake readiness evidence. Fails closed on non-boolean input or a
 * non-2xx answer (contract §7.9).
 */
const DEFAULT_STORAGE_FAULT_PATH = '/conformance/storage-fault';

export async function storageFault(context: HelperContext): Promise<ActualResponse> {
  const raw = context.with.enabled;
  let enabled: boolean;
  if (typeof raw === 'boolean') {
    enabled = raw;
  } else if (typeof raw === 'string') {
    const value = interpolate(raw, context.scope);
    if (value === 'true') enabled = true;
    else if (value === 'false') enabled = false;
    else throw new Error('storage-fault: with.enabled must be a boolean or {{var}} resolving to true/false');
  } else {
    throw new Error('storage-fault: with.enabled must be a boolean or {{var}} resolving to true/false');
  }
  const path = context.with.path === undefined
    ? DEFAULT_STORAGE_FAULT_PATH
    : localPath('storage-fault', sub(context, String(context.with.path)));
  const response = await context.send({
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (response.status < 200 || response.status > 299) {
    throw new Error(`storage-fault: SUT answered ${response.status} to ${path}; the storage-fault capability is unavailable or conformance mode is off`);
  }
  return response;
}

/**
 * `use: mock-idp-authorize` — the runner acts as the browser at the mock IdP:
 * it GETs the SUT's captured login redirect (which must target the configured
 * loopback IdP) and returns the IdP's code-bearing redirect for the scenario to
 * replay at the SUT callback. Only one redirect is followed, on the runner side;
 * the SUT callback is never contacted by this helper.
 */
export async function mockIdpAuthorize(context: HelperContext): Promise<ActualResponse> {
  const idp = context.mockIdp;
  if (idp === undefined) {
    throw new Error('mock-idp-authorize: no mock IdP configured (pass --sut-config with mockIdp.origin)');
  }
  const raw = context.with.location;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('mock-idp-authorize: with.location must be the captured login redirect Location');
  }
  const location = sub(context, raw);
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new Error('mock-idp-authorize: with.location is not an absolute URL');
  }
  if (url.origin !== idp.origin) {
    throw new Error(`mock-idp-authorize: login redirect targets ${url.origin}, not the configured mock IdP ${idp.origin}`);
  }
  let response: globalThis.Response;
  try {
    response = await fetch(url, { redirect: 'manual' });
  } catch (cause) {
    throw new Error(`mock-idp-authorize: mock IdP request failed (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  const actual = toActualResponse(response.status, headers, await response.text());
  if (actual.status !== 302 && actual.status !== 303) {
    throw new Error(`mock-idp-authorize: mock IdP answered ${actual.status} to ${url.pathname}; expected a code-bearing redirect`);
  }
  if (actual.redirect?.query.code === undefined || actual.redirect?.query.state === undefined) {
    throw new Error('mock-idp-authorize: mock IdP redirect is missing code or state');
  }
  return actual;
}

/**
 * `use: sut-restart` — run the harness-configured restart command (never taken
 * from the scenario), then poll readiness until the SUT answers 2xx again.
 */
export async function sutRestart(context: HelperContext): Promise<ActualResponse> {
  const config = context.sut?.restart;
  if (config === undefined) throw new Error('sut-restart: no restart command configured (pass --sut-config with a restart.command)');
  if (context.baseUrl === undefined) throw new Error('sut-restart: runner did not supply the SUT base URL');
  const timeoutMs = config.readyTimeoutMs ?? 60_000;
  const pollMs = config.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  await new Promise<void>((resolve, reject) => {
    execFile(config.command, [], { env: { ...process.env, OAUTH2_CONFORMANCE_BASE_URL: context.baseUrl as string }, timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error !== null) reject(new Error(`sut-restart: restart command failed: ${error.message}${stderr ? ` (${stderr.trim().slice(0, 200)})` : ''}`));
      else resolve();
    });
  });

  const readyUrl = resolveUrl(context.baseUrl, config.readyPath ?? '/health');
  for (;;) {
    try {
      const probe = await sendRequest({ method: 'GET', url: readyUrl, headers: {} }, { timeoutMs: Math.max(1, Math.min(2_000, deadline - Date.now())) });
      if (probe.status >= 200 && probe.status < 300) break;
    } catch {
      // connection refused / timeout while the process is coming back: keep polling
    }
    if (Date.now() >= deadline) throw new Error(`sut-restart: SUT did not become ready at ${config.readyPath ?? '/health'} within ${timeoutMs}ms`);
    await sleep(pollMs);
  }
  return { status: 200, headers: {}, body: { restarted: true } };
}

/** `use: request-on-instance` — `with.instance` plus method/path/query/headers/form|json. */
export async function requestOnInstance(context: HelperContext): Promise<ActualResponse> {
  const instances = context.sut?.instances;
  if (instances === undefined) throw new Error('request-on-instance: no instances configured (pass --sut-config with instances)');
  const name = context.with.instance;
  if (typeof name !== 'string' || name === '') throw new Error('request-on-instance: with.instance must be a nonempty string');
  const base = Object.hasOwn(instances, name) ? instances[name] : undefined;
  if (base === undefined) throw new Error(`request-on-instance: unknown instance "${name}" (configured: ${Object.keys(instances).join(', ')})`);
  const built = buildRequest('request-on-instance', context);
  return sendRequest({ method: built.method, url: resolveUrl(base, built.path), headers: built.headers, ...(built.body !== undefined ? { body: built.body } : {}) });
}

function selectClientCert(helper: string, sut: SutRuntime | undefined, name: unknown): MtlsClientCert | undefined {
  if (sut?.mtls === undefined) throw new Error(`${helper}: no mtls listener configured (pass --sut-config with mtls)`);
  if (name === undefined) return undefined;
  if (typeof name !== 'string' || name === '') throw new Error(`${helper}: with.cert must be a nonempty string`);
  const found = Object.hasOwn(sut.mtls.clients, name) ? sut.mtls.clients[name] : undefined;
  if (found === undefined) throw new Error(`${helper}: unknown client certificate "${name}" (configured: ${Object.keys(sut.mtls.clients).join(', ')})`);
  return found;
}

/**
 * `use: mtls-request` — `with.cert` names a harness-configured client
 * certificate; omit it to connect without one. Server trust uses the configured
 * CA; certificate-verification failures are errors, never silently ignored.
 */
export async function mtlsRequest(context: HelperContext): Promise<ActualResponse> {
  const client = selectClientCert('mtls-request', context.sut, context.with.cert);
  const mtls = context.sut?.mtls;
  if (mtls === undefined) throw new Error('mtls-request: no mtls listener configured');
  const built = buildRequest('mtls-request', context);
  const url = new URL(resolveUrl(mtls.baseUrl, built.path));
  return new Promise<ActualResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: built.method,
        headers: { ...built.headers, ...(built.body !== undefined ? { 'content-length': String(Buffer.byteLength(built.body)) } : {}) },
        ...(mtls.ca !== undefined ? { ca: mtls.ca } : {}),
        ...(client !== undefined ? { cert: client.cert, key: client.key } : {}),
        rejectUnauthorized: true,
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve(toActualResponse(res.statusCode ?? 0, headers, Buffer.concat(chunks).toString('utf8')));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('mtls-request: request timed out')));
    req.on('error', reject);
    if (built.body !== undefined) req.write(built.body);
    req.end();
  });
}

/** `use: x5t-s256` — `with.cert` (configured name) or `with.pem` (PEM text, may use `{{var}}`). */
export async function x5tThumbprint(context: HelperContext): Promise<ActualResponse> {
  const { cert, pem } = context.with;
  let certificate: string;
  if (typeof pem === 'string' && pem !== '') {
    certificate = sub(context, pem);
  } else if (typeof cert === 'string' && cert !== '') {
    const selected = selectClientCert('x5t-s256', context.sut, cert);
    if (selected === undefined) throw new Error('x5t-s256: with.cert must be a nonempty string');
    certificate = selected.cert;
  } else {
    throw new Error('x5t-s256: with.cert or with.pem is required');
  }
  return { status: 200, headers: {}, body: { x5t_s256: x5tS256(certificate) } };
}
