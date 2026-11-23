/**
 * Local back-channel logout receiver for the conformance runner.
 *
 * The SUT posts a `logout_token` form to a loopback URI seeded in the client
 * registration (seed field `backchannel_logout_uri`). The runner owns this
 * listener, never the SUT: all evidence is observed on the wire. The listener
 * only accepts `application/x-www-form-urlencoded` POSTs carrying a non-empty
 * `logout_token`, and is bound to 127.0.0.1 so no external client can inject
 * evidence into a run.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedLogoutToken {
  logout_token: string;
  content_type: string;
  received_at: string;
}

export interface LogoutReceiver {
  /** Full URI the SUT must POST to (origin + path). */
  url: string;
  waitForLogoutToken(timeoutMs?: number): Promise<CapturedLogoutToken>;
  /** All captures received so far, oldest first. */
  captured(): readonly CapturedLogoutToken[];
  close(): Promise<void>;
}

/** Decode HTML entities that can legally appear in a logout token form value. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Start a loopback-only receiver. `port: 0` binds an ephemeral port (used by
 * unit tests); conformance runs supply the fixed port from `--sut-config`,
 * whose origin matches the seeded `backchannel_logout_uri`.
 */
export async function startLogoutReceiver(options: { host?: string; port: number; path?: string } = { port: 0 }): Promise<LogoutReceiver> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') throw new TypeError('logout receiver must bind to 127.0.0.1 or localhost');
  const path = options.path ?? '/backchannel-logout';
  if (!path.startsWith('/') || path.startsWith('//')) throw new TypeError('logout receiver path must start with a single /');

  const captures: CapturedLogoutToken[] = [];
  const waiters: Array<(token: CapturedLogoutToken) => void> = [];

  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (req.method !== 'POST' || !contentType.startsWith('application/x-www-form-urlencoded')) {
      res.writeHead(415, { 'content-type': 'text/plain' }).end('unsupported media type');
      return;
    }
    let raw = '';
    try {
      for await (const chunk of req) raw += String(chunk);
      const params = new URLSearchParams(raw);
      const logoutToken = params.get('logout_token');
      if (logoutToken === null || logoutToken === '') {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('missing logout_token');
        return;
      }
      const captured: CapturedLogoutToken = {
        logout_token: decodeEntities(logoutToken),
        content_type: contentType,
        received_at: new Date().toISOString(),
      };
      captures.push(captured);
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(captured);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('invalid form body');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}${path}`;

  return {
    url,
    async waitForLogoutToken(timeoutMs = 5000): Promise<CapturedLogoutToken> {
      const existing = captures.shift();
      if (existing !== undefined) return existing;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
        throw new TypeError('logout receiver timeout must be an integer between 0 and 60000 ms');
      }
      return new Promise<CapturedLogoutToken>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(onToken);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`logout receiver timed out after ${timeoutMs} ms waiting for a logout_token POST`));
        }, timeoutMs);
        function onToken(token: CapturedLogoutToken): void {
          clearTimeout(timer);
          resolve(token);
        }
        waiters.push(onToken);
      });
    },
    captured(): readonly CapturedLogoutToken[] {
      return captures;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

/**
 * Parse front-channel logout iframes out of a rendered logout page.
 * Only `iframe[src]` values are returned; entities are decoded, whitespace
 * trimmed, and empty or non-http(s) sources omitted. Attribute values may be
 * double- or single-quoted.
 */
export function parseFrontchannelIframes(html: string): string[] {
  const sources: string[] = [];
  const iframeTags = /<iframe\b[^>]*>/gi;
  const srcAttr = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  for (const tag of html.match(iframeTags) ?? []) {
    const match = srcAttr.exec(tag);
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (raw === undefined) continue;
    const src = decodeEntities(raw).trim();
    if (src === '') continue;
    try {
      const parsed = new URL(src);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    sources.push(src);
  }
  return sources;
}
