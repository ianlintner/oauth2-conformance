/**
 * SUT interface v2 runtime configuration (contract/sut-interface.md section 7).
 *
 * The harness, not a scenario, supplies everything here: scenario files can name
 * a capability (`use: sut-restart`) but can never choose which program to
 * execute or which private key to present. A capability that is not configured
 * makes its helper fail closed, so a scenario that needs it stays deferred
 * instead of passing vacuously.
 */

import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LogoutReceiver } from './logout-receiver.js';
import type { MockIdp } from './mock-idp.js';

export interface MockIdpConfig {
  /** Loopback origin the SUT's provider base URL points at, e.g. `http://127.0.0.1:8098`. */
  origin: string;
}

export interface LogoutReceiverConfig {
  /** Loopback origin the SUT is seeded with, e.g. `http://127.0.0.1:8099`. */
  origin: string;
  /** Path of the back-channel logout URI. Default `/backchannel-logout`. */
  path?: string;
}

export interface SutRestartConfig {
  /** Executable run directly (no shell) with `OAUTH2_CONFORMANCE_BASE_URL` in its env. */
  command: string;
  /** Readiness path polled after the command exits. Default `/health`. */
  readyPath?: string;
  /** Upper bound for command + readiness. Default 60000. */
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface MtlsClientCert {
  /** PEM certificate chain presented to the SUT. */
  cert: string;
  /** PEM private key; stays in the runner process and is never output. */
  key: string;
}

export interface MtlsConfig {
  /** `https://host:port` of the SUT's mTLS listener. */
  baseUrl: string;
  /** PEM trust anchor(s) for the SUT's server certificate. Default: system trust. */
  ca?: string;
  clients: Record<string, MtlsClientCert>;
}

/**
 * Exposition-family names for the operations §3 metric scenarios.
 *
 * The contract defines metric *behaviour* (a status-class counter, a duration
 * histogram, a failed-authentication counter) but not the family names a port
 * chooses. The harness supplies them here; scenarios reference the semantic
 * keys as `{{metrics.<key>}}`, so a spec-correct port is not failed for using
 * different names. Missing keys fail closed as unbound variables.
 */
export interface SutMetricsConfig {
  requestsTotal?: string;
  requestsByStatusClass?: string;
  statusClassLabel?: string;
  successStatusClass?: string;
  durationBucket?: string;
  durationCount?: string;
  failedAuthentications?: string;
}

export interface SutRuntime {
  /** name -> origin of each SUT process sharing one store (`request-on-instance`). */
  instances?: Record<string, string>;
  restart?: SutRestartConfig;
  mtls?: MtlsConfig;
  /** Harness-supplied loopback receiver config (contract section 7.8). */
  logoutReceiver?: LogoutReceiverConfig;
  /** Live listener started by the CLI for that config; not parsed from YAML. */
  logoutReceiverInstance?: LogoutReceiver;
  /** Harness-supplied mock IdP origin (contract section 7.10). */
  mockIdp?: MockIdpConfig;
  /** Live mock IdP started by the CLI; not parsed from YAML. */
  mockIdpInstance?: MockIdp;
  /** Harness-supplied exposition family names (contract section 7.7). */
  metrics?: SutMetricsConfig;
}

/** RFC 8705 `x5t#S256`: base64url SHA-256 of the DER certificate, no padding. */
export function x5tS256(pem: string): string {
  let der: Buffer;
  try {
    der = new X509Certificate(pem).raw;
  } catch (cause) {
    throw new Error(`x5t#S256: input is not a PEM certificate (${cause instanceof Error ? cause.message : String(cause)})`, { cause });
  }
  return createHash('sha256').update(der).digest('base64url');
}

const TOP_KEYS = ['instances', 'restart', 'mtls', 'logoutReceiver', 'mockIdp', 'metrics'];

/** Prometheus exposition identifier grammars (metric family vs label name). */
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const METRICS_KEYS = [
  'requestsTotal',
  'requestsByStatusClass',
  'statusClassLabel',
  'successStatusClass',
  'durationBucket',
  'durationCount',
  'failedAuthentications',
] as const;

function parseMetrics(value: unknown): SutMetricsConfig {
  const raw = obj(value, 'metrics');
  exactKeys(raw, [...METRICS_KEYS], 'metrics');
  const out: SutMetricsConfig = {};
  for (const key of METRICS_KEYS) {
    if (raw[key] === undefined) continue;
    const text = nonEmpty(raw[key], `metrics.${key}`);
    const pattern = key === 'statusClassLabel' ? LABEL_NAME : key === 'successStatusClass' ? undefined : METRIC_NAME;
    if (pattern !== undefined && !pattern.test(text)) {
      throw new TypeError(`metrics.${key} must be a valid Prometheus ${key === 'statusClassLabel' ? 'label' : 'metric'} name`);
    }
    Object.assign(out, { [key]: text });
  }
  return out;
}

function obj(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}: unknown key "${key}"`);
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function origin(value: unknown, label: string, protocols: string[], what: string): string {
  const text = nonEmpty(value, label);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError(`${label} must be ${what}`);
  }
  if (!protocols.includes(url.protocol)) throw new TypeError(`${label} must be ${what}`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new TypeError(`${label} must be an origin (scheme://host[:port]) with no path, query or credentials`);
  }
  return url.origin;
}

/**
 * Parse the harness-supplied SUT config (JSON or YAML) and read the referenced
 * PEM files. Relative paths resolve against `baseDir` (the config's directory).
 */
export async function parseSutConfig(text: string, baseDir: string): Promise<SutRuntime> {
  const root = obj(parseYaml(text) ?? {}, 'sut config');
  exactKeys(root, TOP_KEYS, 'sut config');
  const out: SutRuntime = {};

  if (root.instances !== undefined) {
    const raw = obj(root.instances, 'instances');
    const instances: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw)) {
      instances[name] = origin(value, `instances.${name}`, ['http:', 'https:'], 'an http(s) URL');
    }
    if (Object.keys(instances).length === 0) throw new TypeError('instances must name at least one instance');
    out.instances = instances;
  }

  if (root.restart !== undefined) {
    const raw = obj(root.restart, 'restart');
    exactKeys(raw, ['command', 'readyPath', 'readyTimeoutMs', 'pollIntervalMs'], 'restart');
    const readyPath = raw.readyPath === undefined ? undefined : nonEmpty(raw.readyPath, 'restart.readyPath');
    if (readyPath !== undefined && (!readyPath.startsWith('/') || readyPath.startsWith('//'))) throw new TypeError('restart.readyPath must start with /');
    out.restart = {
      command: path.resolve(baseDir, nonEmpty(raw.command, 'restart.command')),
      ...(readyPath !== undefined ? { readyPath } : {}),
      ...(raw.readyTimeoutMs !== undefined ? { readyTimeoutMs: positiveInt(raw.readyTimeoutMs, 'restart.readyTimeoutMs') } : {}),
      ...(raw.pollIntervalMs !== undefined ? { pollIntervalMs: positiveInt(raw.pollIntervalMs, 'restart.pollIntervalMs') } : {}),
    };
  }

  if (root.mtls !== undefined) {
    const raw = obj(root.mtls, 'mtls');
    exactKeys(raw, ['baseUrl', 'caFile', 'clients'], 'mtls');
    const baseUrl = (() => {
      const text_ = nonEmpty(raw.baseUrl, 'mtls.baseUrl');
      if (!text_.startsWith('https://')) throw new TypeError('mtls.baseUrl must be an https URL');
      return origin(text_, 'mtls.baseUrl', ['https:'], 'an https URL');
    })();
    const clients: Record<string, MtlsClientCert> = {};
    for (const [name, value] of Object.entries(obj(raw.clients ?? {}, 'mtls.clients'))) {
      const client = obj(value, `mtls.clients.${name}`);
      exactKeys(client, ['certFile', 'keyFile'], `mtls.clients.${name}`);
      clients[name] = {
        cert: await readFile(path.resolve(baseDir, nonEmpty(client.certFile, `mtls.clients.${name}.certFile`)), 'utf8'),
        key: await readFile(path.resolve(baseDir, nonEmpty(client.keyFile, `mtls.clients.${name}.keyFile`)), 'utf8'),
      };
    }
    out.mtls = {
      baseUrl,
      ...(raw.caFile !== undefined ? { ca: await readFile(path.resolve(baseDir, nonEmpty(raw.caFile, 'mtls.caFile')), 'utf8') } : {}),
      clients,
    };
  }

  if (root.logoutReceiver !== undefined) {
    const raw = obj(root.logoutReceiver, 'logoutReceiver');
    exactKeys(raw, ['origin', 'path'], 'logoutReceiver');
    const configured = origin(raw.origin, 'logoutReceiver.origin', ['http:'], 'an http loopback URL');
    const url = new URL(configured);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new TypeError('logoutReceiver.origin must use a loopback host supported by the receiver (127.0.0.1 or localhost)');
    }
    const receiverPath = raw.path === undefined ? '/backchannel-logout' : nonEmpty(raw.path, 'logoutReceiver.path');
    if (!receiverPath.startsWith('/') || receiverPath.startsWith('//')) {
      throw new TypeError('logoutReceiver.path must start with a single /');
    }
    out.logoutReceiver = { origin: configured, path: receiverPath };
  }

  if (root.mockIdp !== undefined) {
    const raw = obj(root.mockIdp, 'mockIdp');
    exactKeys(raw, ['origin'], 'mockIdp');
    const configured = origin(raw.origin, 'mockIdp.origin', ['http:'], 'an http loopback URL');
    const url = new URL(configured);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new TypeError('mockIdp.origin must use a loopback host supported by the runner (127.0.0.1 or localhost)');
    }
    out.mockIdp = { origin: configured };
  }

  if (root.metrics !== undefined) out.metrics = parseMetrics(root.metrics);
  return out;
}
