/**
 * Runner helpers for OIDC logout evidence.
 *
 * `read-logout-token` retrieves the form POST captured by the local
 * back-channel receiver; `frontchannel-capture` parses iframe sources from an
 * HTML body captured by a previous scenario step. Both fail closed: a missing
 * capability, missing variable, or malformed evidence raises rather than
 * returning a vacuous success.
 */

import { interpolate } from './scenario.js';
import { parseFrontchannelIframes, type LogoutReceiver } from './logout-receiver.js';
import type { HelperContext, ScenarioHelper } from './runner.js';
import type { ActualResponse } from './compare.js';

export type LogoutHelperContext = HelperContext & {
  logoutReceiver?: LogoutReceiver;
};

function positiveWait(value: unknown): number {
  const ms = typeof value === 'string' ? Number(value) : value;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > 60_000) {
    throw new TypeError('read-logout-token: with.waitMs must be an integer between 0 and 60000');
  }
  return ms;
}

/** Wait for a `logout_token` POST and expose it as an assertable JSON response. */
export const readLogoutToken: ScenarioHelper = async (rawContext): Promise<ActualResponse> => {
  const context = rawContext as LogoutHelperContext;
  const receiver = context.logoutReceiver ?? context.sut?.logoutReceiverInstance;
  if (receiver === undefined) throw new Error('read-logout-token: no back-channel logout receiver configured (--sut-config logoutReceiver)');
  const waitMs = positiveWait(context.with.waitMs ?? 5000);
  const captured = await receiver.waitForLogoutToken(waitMs);
  return {
    status: 200,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { logout_token: captured.logout_token },
  };
};

/** Parse iframe src attributes from a captured HTML response body. */
export const frontchannelCapture: ScenarioHelper = async (context): Promise<ActualResponse> => {
  const raw = context.with.body;
  if (typeof raw !== 'string' || raw === '') throw new TypeError('frontchannel-capture: with.body is required');
  const html = interpolate(raw, context.scope);
  if (html.includes('{{')) throw new Error('frontchannel-capture: unbound variable in with.body');
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { iframe_srcs: parseFrontchannelIframes(html) },
  };
};
