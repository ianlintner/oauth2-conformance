/**
 * Runner step helpers.
 *
 * `login-and-authorize` drives the interactive authorization-code flow a
 * black-box SUT exposes: the runner posts credentials to the SUT's test-mode
 * login form, follows the resulting authorization redirect, and returns the
 * redirect response so the scenario can assert on the `code` it carries.
 *
 * The helper is deliberately thin: it performs HTTP the SUT already offers and
 * never assumes a particular framework, session cookie name or HTML shape
 * beyond a form that accepts `username` and `password`.
 */

import { headerValue } from './compare.js';
import type { HelperContext } from './runner.js';

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`login-and-authorize: with.${name} must be a nonempty string`);
  return value;
}

function cookieFrom(response: { headers: Record<string, string> }, previous?: string): string | undefined {
  const setCookie = headerValue(response.headers, 'set-cookie');
  if (setCookie !== undefined) return setCookie.split(';')[0];
  return previous;
}

/**
 * True when `location` is the SUT's own login step: a same-origin relative
 * target (path starts with `/`, not `//`) whose pathname equals the contract
 * login path (or the common `/login`, `/auth/login`). Absolute redirects go to
 * the client and are the final authorization response.
 */
function isLoginRedirect(location: string, loginPath: string): boolean {
  if (!location.startsWith('/') || location.startsWith('//')) return false;
  const pathname = location.split(/[?#]/, 1)[0] ?? '';
  return pathname === loginPath || pathname.endsWith('/login');
}

export async function loginAndAuthorize(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const username = requireString(context.with.username, 'username');
  const password = requireString(context.with.password, 'password');
  const authorizePath = requireString(context.with.authorizePath, 'authorizePath');

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(context.with.query ?? {})) {
    query.append(key, String(value).replace(/\{\{([^}]+)\}\}/g, (_m, name: string) => context.scope.get(name) ?? ''));
  }
  const authorizeUrl = query.size > 0 ? `${authorizePath}?${query.toString()}` : authorizePath;

  const authorize = await context.send({
    method: 'GET',
    url: authorizeUrl,
    headers: {},
  });

  const loginPath = typeof context.with.loginPath === 'string' ? context.with.loginPath : '/login';

  // A SUT that needs no interactive login (granted consent) redirects straight
  // back to the client; report that response. A redirect to the SUT's own
  // login step (a same-origin relative target at loginPath) is NOT the final
  // authorization response: continue by submitting credentials.
  if (authorize.status >= 300 && authorize.status < 400 && authorize.redirect !== undefined && !isLoginRedirect(authorize.redirect.location, loginPath)) {
    return authorize;
  }

  const cookie = cookieFrom(authorize);
  const body = new URLSearchParams({ username, password }).toString();
  const login = await context.send({
    method: 'POST',
    url: loginPath,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie !== undefined ? { cookie } : {}),
    },
    body,
  });
  if (login.status >= 400) {
    throw new Error(`login-and-authorize: SUT login failed with status ${login.status}`);
  }

  const loginCookie = cookieFrom(login, cookie);
  return context.send({
    method: 'GET',
    url: authorizeUrl,
    headers: {
      ...(loginCookie !== undefined ? { cookie: loginCookie } : {}),
    },
  });
}
