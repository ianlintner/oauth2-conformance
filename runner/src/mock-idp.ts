/**
 * Runner-owned mock identity provider (contract/sut-interface.md section 7.10).
 *
 * A loopback-only HTTP listener with the three endpoints a SUT needs for a
 * social-login round trip: `/authorize` issues a synthetic code, `/token`
 * exchanges it once for a synthetic access token (with optional S256 PKCE
 * verification), and `/userinfo` returns synthetic claims. Nothing is fetched
 * from a third party, no real credentials are used, and the listener binds only
 * to 127.0.0.1/localhost so external clients cannot inject evidence into a run.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface IssuedCode {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
  used: boolean;
}

export interface MockIdp {
  /** Base origin of the listener (`http://127.0.0.1:<port>`). */
  origin: string;
  /** Number of synthetic codes issued so far (diagnostics only). */
  issuedCount(): number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const SYNTHETIC_USER = {
  sub: 'conformance-user',
  email: 'conformance@example.test',
  email_verified: true,
  name: 'Conformance User',
};

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

/**
 * Start the mock IdP on a fixed loopback origin. `port: 0` binds an ephemeral
 * port, which is what unit tests use; conformance runs use the fixed origin
 * from `--sut-config`, to which the SUT's provider base URL must point.
 */
export async function startMockIdp(options: { origin: string }): Promise<MockIdp> {
  const configured = new URL(options.origin);
  if (configured.protocol !== 'http:' || !isLoopbackHost(configured.hostname) || configured.pathname !== '/') {
    throw new TypeError('mock IdP origin must be an http loopback origin with no path (127.0.0.1 or localhost)');
  }
  const host = configured.hostname === '[::1]' ? '::1' : configured.hostname;
  const port = Number(configured.port || 80);

  const codes = new Map<string, IssuedCode>();
  const tokens = new Set<string>();

  async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
    let raw = '';
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(String(chunk));
      if (bytes > MAX_BODY_BYTES) throw new RangeError('body too large');
      raw += String(chunk);
    }
    return new URLSearchParams(raw);
  }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock-idp.invalid');
    const pathname = url.pathname;
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const text = (status: number, body: string): void => {
      res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end(body);
    };

    try {
      if (pathname === '/authorize') {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' }).end('method not allowed');
          return;
        }
        const state = url.searchParams.get('state');
        const redirectUri = url.searchParams.get('redirect_uri');
        if (state === null || state === '' || redirectUri === null || redirectUri === '') {
          text(400, 'state and redirect_uri are required');
          return;
        }
        let destination: URL;
        try {
          destination = new URL(redirectUri);
        } catch {
          text(400, 'redirect_uri must be an absolute http(s) URL');
          return;
        }
        if (!['http:', 'https:'].includes(destination.protocol) || !isLoopbackHost(destination.hostname)) {
          text(400, 'redirect_uri must be a loopback http(s) URL');
          return;
        }
        const challenge = url.searchParams.get('code_challenge');
        const method = url.searchParams.get('code_challenge_method');
        if (challenge !== null && method !== null && method !== 'S256') {
          text(400, 'unsupported code_challenge_method');
          return;
        }
        const code = `mock-code-${randomBytes(16).toString('base64url')}`;
        codes.set(code, {
          state,
          redirectUri,
          ...(challenge !== null && challenge !== '' ? { codeChallenge: challenge } : {}),
          used: false,
        });
        destination.searchParams.set('code', code);
        destination.searchParams.set('state', state);
        res.writeHead(302, { location: destination.toString(), 'cache-control': 'no-store' }).end();
        return;
      }

      if (pathname === '/token') {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' }).end('method not allowed');
          return;
        }
        const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
        if (!contentType.startsWith('application/x-www-form-urlencoded')) {
          res.writeHead(415, { 'content-type': 'text/plain' }).end('unsupported media type');
          return;
        }
        const form = await readForm(req);
        if (form.get('grant_type') !== 'authorization_code') {
          json(400, { error: 'unsupported_grant_type' });
          return;
        }
        const code = form.get('code') ?? '';
        const issued = codes.get(code);
        if (issued === undefined || issued.used) {
          json(400, { error: 'invalid_grant' });
          return;
        }
        if (form.get('redirect_uri') !== null && form.get('redirect_uri') !== issued.redirectUri) {
          json(400, { error: 'invalid_grant' });
          return;
        }
        if (issued.codeChallenge !== undefined) {
          const verifier = form.get('code_verifier') ?? '';
          const computed = createHash('sha256').update(verifier).digest('base64url');
          if (computed !== issued.codeChallenge) {
            json(400, { error: 'invalid_grant' });
            return;
          }
        }
        // Consume before responding: a code is single use even under retries.
        issued.used = true;
        const accessToken = `mock-at-${randomBytes(16).toString('base64url')}`;
        tokens.add(accessToken);
        json(200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile',
        });
        return;
      }

      if (pathname === '/userinfo') {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' }).end('method not allowed');
          return;
        }
        const authorization = String(req.headers.authorization ?? '');
        const match = /^Bearer (\S+)$/.exec(authorization);
        if (match === null || !tokens.has(match[1] as string)) {
          json(401, { error: 'invalid_token' });
          return;
        }
        json(200, SYNTHETIC_USER);
        return;
      }

      text(404, 'not found');
    } catch (cause) {
      if (cause instanceof RangeError) {
        res.writeHead(413, { 'content-type': 'text/plain' }).end('body too large');
        req.destroy();
        return;
      }
      text(400, 'invalid request');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const origin = `http://${configured.hostname}:${address.port}`;

  return {
    origin,
    issuedCount: () => codes.size,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}
