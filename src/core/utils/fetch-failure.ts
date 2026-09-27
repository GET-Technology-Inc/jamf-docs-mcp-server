/**
 * Why a request to learn.jamf.com failed, in words a caller can act on, and
 * whether trying it again may help.
 *
 * Written for the glossary's failure messages (#324) and shared with the
 * search's since 2026-09-28, so the two tools name the same failure the same
 * way and give the same advice about it.
 */

import { HttpError } from '../http-client.js';
import { sanitizeErrorMessage } from './sanitize.js';

/** Why one request failed: "HTTP 503 Service Unavailable", "the request timed out", and so on. */
export function describeFetchFailure(error: unknown): string {
  // Not `error.message`: an HttpError's ends in the request URL, which is
  // noise in a message for the caller, and fetch reports every network
  // failure as the bare "fetch failed", with the reason on `cause`.
  if (error instanceof HttpError) {
    return `HTTP ${String(error.status)}${error.statusText !== '' ? ` ${error.statusText}` : ''}`;
  }
  if (!(error instanceof Error)) { return 'an unknown error'; }
  if (error.name === 'TimeoutError') { return 'the request timed out'; }
  if (error instanceof SyntaxError) { return 'a response that was not valid JSON'; }
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string') { return `a network error: ${code}`; }
  if (error instanceof TypeError) { return 'a network error'; }
  return sanitizeErrorMessage(error.message);
}

/**
 * Whether `error` is one a request through `http-client` fails with: an
 * `HttpError`, a timeout, fetch's network error, or a body that was not valid
 * JSON.
 *
 * Anything else was thrown by something other than the request: a cache, a
 * provider, or code reading an answer that did not have the expected shape.
 * {@link describeFetchFailure} is only for a request, because it calls any
 * `TypeError` a network error, and "maps.map is not a function" is not one.
 */
export function isRequestFailure(error: unknown): boolean {
  if (error instanceof HttpError || error instanceof SyntaxError) { return true; }
  if (!(error instanceof Error)) { return false; }
  if (error.name === 'TimeoutError') { return true; }
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return error instanceof TypeError && (error.message === 'fetch failed' || typeof code === 'string');
}

/**
 * Whether the same request, sent again in a moment, may succeed.
 *
 * A 4xx other than 408 (Request Timeout) and 429 (Too Many Requests) is the
 * request itself refused, and sent again it is refused again. Anything else a
 * request fails with may pass the next time: a 5xx, a 408 or a 429, a timeout,
 * a network error, or a body that was not valid JSON.
 *
 * One rule for the glossary and the search. Until 2026-09-28 the glossary said
 * a failed request "may be temporary" whatever its status, a 400 or a 404
 * included.
 */
export function mayBeTemporary(error: unknown): boolean {
  if (!(error instanceof HttpError)) { return true; }
  const { status } = error;
  return status < 400 || status >= 500 || status === 408 || status === 429;
}

/** The sentence a failure message ends with when {@link mayBeTemporary} holds. */
export const MAY_BE_TEMPORARY = 'This may be temporary: try again in a moment.';
