/**
 * What a reply says went wrong when the tool or resource has no words of its
 * own for the failure: the catch-all of `jamf_docs_get_toc`,
 * `jamf_docs_get_article`, `jamf_docs_batch_get_articles` and
 * `jamf://products/{productId}/toc`, and the last-resort catch of the search,
 * the glossary and `jamf_docs_list_products`.
 *
 * Until 2026-09-28 each quoted the error's message as it was, with file paths
 * and stack lines removed, except the TOC resource, which removed nothing. A
 * provider that threw a 40,000-character message got a `get_toc` error of
 * 40,091 characters over six lines, a markdown heading and a list item among
 * them, and the TOC resource an error of 40,173 with the provider's file path
 * and stack lines in it. A provider that threw `new Error('')` got "Error
 * fetching table of contents: ", with nothing after the colon, and one that
 * rejected with `undefined`, "Unknown error occurred". A request that failed
 * was quoted as the runtime words it: "fetch failed", "The operation was
 * aborted due to timeout".
 */

import { HttpError } from '../http-client.js';
import { JamfDocsError } from '../types.js';
import { MapsProviderError } from './maps-registry.js';
import { ProviderError } from './provider-error.js';
import { describeMapsListFailure } from './maps-list-failure.js';
import { describeFetchFailure, isRequestFailure, reasonGiven, reasonStated } from '../utils/fetch-failure.js';

/** What {@link failureReason} says of a failure that gives no reason. */
export const NO_REASON_GIVEN = 'no reason was given';

/**
 * What went wrong, to follow "Error fetching table of contents: " and the
 * like.
 *
 * - A TocProvider, ArticleProvider or GlossaryProvider that threw
 *   ({@link ProviderError}): its reason ({@link reasonGiven}: on one line,
 *   with file paths and stack lines removed, and cut to 200 characters),
 *   whatever it threw. A provider's HttpError, SyntaxError or TimeoutError is
 *   its own, not a request of this server's.
 * - A MapsProvider that threw ({@link MapsProviderError}): the list of
 *   documentation maps could not be read from the configured maps provider,
 *   with its reason, in the words the search, the glossary and
 *   `jamf_docs_list_products` use ({@link describeMapsListFailure}).
 * - A request of this server's ({@link isRequestFailure}): why it failed, as
 *   the search and the glossary say it ({@link describeFetchFailure}). An
 *   HttpError keeps the address it was sent to, which its message always
 *   ended in, because here nothing else says which source failed: "HTTP 503
 *   Service Unavailable: https://learn.jamf.com/api/khub/maps".
 * - This server's own {@link JamfDocsError}: its message on one line, with
 *   file paths and stack lines removed ({@link reasonStated}), and not cut.
 *   This server wrote it, and some quote an address whole: "Could not read a
 *   Jamf Support Knowledge Base article at <url>" is 131 to 437 characters
 *   for the 29 ja and zh-TW support.jamf.com articles captured on 2026-09-26,
 *   whose urls are percent-encoded. A maps list from learn.jamf.com that is
 *   not a list of maps is one: "learn.jamf.com answered with the list of
 *   documentation maps in a form this server could not read". Until
 *   2026-09-28 it was the JavaScript error reading it hit, "maps.map is not
 *   a function".
 * - Anything else, such as a JavaScript error of this server's own: its
 *   reason, cut as a provider's is.
 *
 * Any of these that says nothing is {@link NO_REASON_GIVEN}.
 */
export function failureReason(error: unknown): string {
  if (error instanceof ProviderError) {
    return reasonGiven(error.failure) ?? NO_REASON_GIVEN;
  }
  if (error instanceof MapsProviderError) {
    return `the list of documentation maps ${describeMapsListFailure(error).failed}`;
  }
  if (isRequestFailure(error)) {
    const why = describeFetchFailure(error);
    return error instanceof HttpError ? `${why}: ${error.url}` : why;
  }
  if (error instanceof JamfDocsError) {
    return reasonStated(error) ?? NO_REASON_GIVEN;
  }
  return reasonGiven(error) ?? NO_REASON_GIVEN;
}
