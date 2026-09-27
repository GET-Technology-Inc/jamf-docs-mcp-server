/**
 * What a failure message says of a list of documentation maps that could not
 * be read, so that the tools that say so name the same failure the same way:
 * the search and the glossary in their errors, and `jamf_docs_list_products`
 * in its incomplete note, where a request to learn.jamf.com keeps the note it
 * has always had.
 *
 * The list comes from learn.jamf.com, or from a MapsProvider when one is
 * configured. What the provider throws reaches a caller as a
 * {@link MapsProviderError}, and only that is the provider's failure: an
 * answer the registry cannot use is replaced by the maps on learn.jamf.com
 * (see readProviderMaps), and a failure there is learn.jamf.com's.
 *
 * The search has named the provider this way since #355. Until 2026-09-28
 * the glossary did not. With a provider that threw "KV namespace unavailable",
 * and no request sent to learn.jamf.com, it said the list "could not be
 * fetched from learn.jamf.com (KV namespace unavailable)", and that this
 * "may be temporary". A provider that threw an Error with no message was
 * "from learn.jamf.com ()". A list from learn.jamf.com that was not a list
 * was "a network error", which is what describeFetchFailure calls the
 * registry's `TypeError`, and it too "may be temporary". So was every other
 * failure that was not a request's, an abort or a cache that threw among
 * them: each read as a fetch from learn.jamf.com that failed.
 */

import { MapsProviderError } from './maps-registry.js';
import {
  describeFetchFailure,
  isRequestFailure,
  mayBeTemporary,
  reasonGiven,
  MAY_BE_TEMPORARY,
  UNEXPECTED_FAILURE_ADVICE,
} from '../utils/fetch-failure.js';

/** How a message says the maps list could not be read. */
export interface MapsListFailure {
  /**
   * Ends a sentence whose subject is the list: "could not be fetched from
   * learn.jamf.com (HTTP 503 Service Unavailable)".
   */
  failed: string;
  /** The paragraph the message ends with, or `undefined` for none. */
  advice: string | undefined;
}

/**
 * How a message says the maps list could not be read, from what reading it
 * threw.
 *
 * - A MapsProvider: its own reason ({@link reasonGiven}, which removes file
 *   paths and stack traces, and keeps it to one line of 200 characters), and
 *   no advice, which only the provider could give. Not learn.jamf.com, which
 *   was not asked. It is all this server knows of the failure.
 * - A request to learn.jamf.com: why it failed ({@link describeFetchFailure}),
 *   and "may be temporary" when {@link mayBeTemporary} says so.
 * - Anything else, such as a list from learn.jamf.com that is not a list, or
 *   a fetch that failed in a shape {@link isRequestFailure} does not know: an
 *   abort, or a network `TypeError` that neither says "fetch failed" nor has
 *   a `cause.code`, as another runtime's fetch may throw. Plain words, and
 *   the server log for what went wrong. The error itself is left out,
 *   because a raw JavaScript message ("maps.map is not a function") tells a
 *   caller nothing it can act on.
 */
export function describeMapsListFailure(error: unknown): MapsListFailure {
  if (error instanceof MapsProviderError) {
    const reason = reasonGiven(error.failure);
    const said = reason === undefined ? ', which gave no reason' : ` (${reason})`;
    return { failed: `could not be read from the configured maps provider${said}`, advice: undefined };
  }
  if (isRequestFailure(error)) {
    return {
      failed: `could not be fetched from learn.jamf.com (${describeFetchFailure(error)})`,
      advice: mayBeTemporary(error) ? MAY_BE_TEMPORARY : undefined,
    };
  }
  return { failed: 'could not be read', advice: UNEXPECTED_FAILURE_ADVICE };
}
