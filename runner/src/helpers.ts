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

  const loginPath = typeof context.with.loginPath === 'string' ? context.with.loginPath : '/login';
  const sessionKey = `${loginPath}\u0000${username}\u0000${password}`;
  const sessionMode = typeof context.with.session === 'string' ? context.with.session : undefined;

  // `session: none` — send no cookie and don't save a session (fresh browser).
  if (sessionMode === 'none') {
    return context.send({ method: 'GET', url: authorizeUrl, headers: {} });
  }

  // `session: reuse` — must have a saved session; skip the login form entirely.
  if (sessionMode === 'reuse') {
    const cachedCookie = context.sessions?.get(sessionKey);
    if (cachedCookie === undefined) {
      throw new Error('login-and-authorize: session=reuse but no saved session (did a session=create step run first?)');
    }
    return context.send({ method: 'GET', url: authorizeUrl, headers: { cookie: cachedCookie } });
  }

  // `session: create` — always post credentials fresh, bypassing the cache.
  if (sessionMode === 'create') {
    // Delete any cached session first so we force a fresh login.
    context.sessions?.delete(sessionKey);
  }

  // Default (no explicit session mode, or `session: create`): reuse cached
  // sessions, but fall through to a fresh login when the session is stale
  // or absent.
  if (sessionMode === undefined) {
    const cachedCookie = context.sessions?.get(sessionKey);
    if (cachedCookie !== undefined) {
      const reused = await context.send({ method: 'GET', url: authorizeUrl, headers: { cookie: cachedCookie } });
      const reusedLocation = reused.redirect?.location;
      const needsLogin = reused.status >= 300 && reused.status < 400 && reusedLocation !== undefined && isLoginRedirect(reusedLocation, loginPath);
      if (!needsLogin) return reused;
      context.sessions?.delete(sessionKey);
    }
  }

  const authorize = await context.send({
    method: 'GET',
    url: authorizeUrl,
    headers: {},
  });

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
  // A refused login (bad credentials, throttling) is redirected back to the
  // login form with `error=`; surfacing it here keeps a code-less redirect
  // from being mistaken for an authorization result.
  const loginLocation = login.redirect?.location;
  if (loginLocation !== undefined && isLoginRedirect(loginLocation, loginPath) && /[?&]error=/.test(loginLocation)) {
    throw new Error(`login-and-authorize: SUT login refused (${loginLocation})`);
  }

  const loginCookie = cookieFrom(login, cookie);
  if (loginCookie !== undefined) context.sessions?.set(sessionKey, loginCookie);
  return context.send({
    method: 'GET',
    url: authorizeUrl,
    headers: {
      ...(loginCookie !== undefined ? { cookie: loginCookie } : {}),
    },
  });
}

/**
 * RP-initiated logout helper.
 *
 * `with.id_token_hint` (optional) is sent as the `id_token_hint` query parameter.
 * Returns the logout redirect response so the scenario can assert on the redirect.
 */
export async function logout(context: HelperContext): Promise<import('./compare.js').ActualResponse> {
  const params = new URLSearchParams();
  const idTokenHint = typeof context.with.id_token_hint === 'string' ? context.with.id_token_hint : undefined;
  if (idTokenHint !== undefined) params.set('id_token_hint', idTokenHint);
  params.set('post_logout_redirect_uri', 'http://localhost:8080/logout-done');
  return context.send({
    method: 'GET',
    url: `/logout?${params.toString()}`,
    headers: {},
  });
}
