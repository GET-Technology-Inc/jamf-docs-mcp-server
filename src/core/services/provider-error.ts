/**
 * What an injected TocProvider, ArticleProvider or GlossaryProvider threw,
 * tagged where core calls it.
 *
 * A provider's failure cannot be told from this server's by its shape. A
 * provider that reads R2 or D1 over HTTP fails with the same HttpError,
 * SyntaxError, TimeoutError or `TypeError('fetch failed')` this server's own
 * requests fail with. Untagged, failureReason (failure-reason.ts) would word
 * them as a request of this server's that failed: a TocProvider that threw
 * `SyntaxError('Unexpected token u in JSON at position 0 (KV value for
 * toc:jamf-pro is corrupt)')` would get "a response that was not valid JSON",
 * one that threw a TimeoutError of its own "the request timed out", and one
 * that threw an HttpError its url whole, uncut. Tagged, each is quoted as the
 * provider's own reason, as a MapsProvider's is (`MapsProviderError`, #355,
 * which does the same for the maps list).
 *
 * A SearchProvider's throw is tagged by the search, which words every step's
 * failure itself (`SearchStepError`, step `provider`, in search-service.ts).
 */

/** Which provider threw. */
export type ProviderKind = 'toc' | 'article' | 'glossary';

/**
 * What a provider threw, with the provider's own error as `failure`.
 *
 * The message is the provider's, so a caller that only reads `message` sees
 * what it saw before.
 */
export class ProviderError extends Error {
  readonly provider: ProviderKind;
  readonly failure: unknown;

  constructor(provider: ProviderKind, failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure));
    this.name = 'ProviderError';
    this.provider = provider;
    this.failure = failure;
  }
}

/**
 * What `ask` answers, or a {@link ProviderError} with what it threw.
 *
 * Awaited inside the try, so a provider on untyped code that throws without
 * a promise, or returns its answer without one, is read as one that rejects
 * or resolves.
 */
export async function askProvider<T>(provider: ProviderKind, ask: () => Promise<T> | T): Promise<T> {
  try {
    return await ask();
  } catch (error) {
    throw new ProviderError(provider, error);
  }
}
