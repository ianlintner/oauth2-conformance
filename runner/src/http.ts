/**
 * HTTP transport for the conformance runner.
 *
 * The original typescript-oauth2-server harness called an in-process server
 * (`src/conformance/runner.ts`, @d1999bf). The language-neutral contract is
 * black-box: the runner must drive any implementation over HTTP, so this module
 * wraps `fetch` with the guarantees the comparison layer needs — a redirect is
 * never followed implicitly (the OAuth flows assert on the 302 itself), and
 * every response is returned as a plain `ActualResponse`.
 */

import { parseRedirect, type ActualResponse } from './compare.js';

export interface HttpRequest {
  method: string;
  /** Absolute URL, already joined with the base URL and interpolated. */
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface TransportOptions {
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export async function sendRequest(request: HttpRequest, options: TransportOptions = {}): Promise<ActualResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const raw = await response.text();
  let body: unknown;
  let text: string | undefined;
  const contentType = headers['content-type'] ?? '';
  const looksJson = /\bjson\b/i.test(contentType) || raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[');
  if (raw !== '' && looksJson) {
    try {
      body = JSON.parse(raw);
    } catch {
      text = raw;
    }
  } else if (raw !== '') {
    text = raw;
  }

  const location = headers['location'];
  return {
    status: response.status,
    headers,
    body,
    ...(text !== undefined ? { text } : {}),
    ...(location !== undefined ? { redirect: parseRedirect(location) } : {}),
  };
}

/** Join a configured base URL with a server-local path. */
export function resolveUrl(baseUrl: string, requestPath: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (!requestPath.startsWith('/')) throw new TypeError(`request path must start with /, got ${requestPath}`);
  return `${base}${requestPath}`;
}

export function encodeForm(form: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) params.append(key, value);
  return params.toString();
}
