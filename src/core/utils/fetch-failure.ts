/**
 * Why a request to learn.jamf.com failed, in words a caller can act on, and
 * whether trying it again may help.
 *
 * Written for the glossary's failure messages (#324) and shared with the
 * search's since 2026-09-28, so the two tools name the same failure the same
 * way and give the same advice about it. What a configured provider said, and
 * the advice for a failure that was not a request, are here for the same
 * reason. The other tools' catch-alls word a failure from these too (see
 * services/failure-reason.ts).
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

/** The advice for a failure that was not a request, so no status says whether a retry helps. */
export const UNEXPECTED_FAILURE_ADVICE =
  'Trying again may help. If it keeps failing, the server log says what went wrong.';

/** The most of a provider's reason a reply quotes, in characters, the ellipsis included. */
const MAX_REASON_LENGTH = 200;

/**
 * What `error` says went wrong, with file paths and stack traces removed and
 * on one line, or `undefined` when it says nothing. Not cut: see
 * {@link reasonGiven} for a reason a provider gave.
 */
export function reasonStated(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Stack traces first: sanitizeErrorMessage finds them by their line breaks.
  const reason = sanitizeErrorMessage(raw).replace(/\s+/g, ' ').trim();
  return reason === '' ? undefined : reason;
}

/**
 * What a cut keeps or drops whole: a percent-encoded UTF-8 character (its
 * lead byte's escape and its continuation bytes'), any other `%XX` escape, or
 * one code point, so a surrogate pair is never split either.
 */
const UNCUT = /%[C-Fc-f][0-9A-Fa-f](?:%[89ABab][0-9A-Fa-f])+|%[0-9A-Fa-f]{2}|[\s\S]/gu;

/**
 * {@link reasonStated}, cut to {@link MAX_REASON_LENGTH} characters. A
 * provider can reject with a string, with `undefined`, or with an Error whose
 * message is empty.
 *
 * The provider, not this server, decides what the reason says, and every
 * tool quotes it, `jamf_docs_list_products` in an incomplete note that no
 * `maxTokens` cut takes and whose markdown blockquote a line break would end.
 * Until 2026-09-28 each tool that quoted it quoted it whole, line breaks and
 * all: a provider that threw a 40,000-character message got a glossary error
 * of 40,285 characters, a search error of 40,216 from a SearchProvider, and a
 * `jamf_docs_get_toc` error of 40,091 from a TocProvider.
 *
 * The cut never falls inside a `%XX` escape, or between the escapes of one
 * encoded character (see {@link UNCUT}), so a url a reason quotes ends on
 * something a reader can decode. Cut by code point alone, a support.jamf.com
 * url's `%E9%96%A2` could end as `%E9%96%A`, or `%E9%96`.
 */
export function reasonGiven(error: unknown): string | undefined {
  const reason = reasonStated(error);
  if (reason === undefined || Array.from(reason).length <= MAX_REASON_LENGTH) { return reason; }
  let kept = '';
  let length = 0;
  for (const [unit] of reason.matchAll(UNCUT)) {
    const size = Array.from(unit).length;
    if (length + size > MAX_REASON_LENGTH - 1) { break; }
    kept += unit;
    length += size;
  }
  return `${kept.trimEnd()}…`;
}
