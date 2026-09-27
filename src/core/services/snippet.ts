/**
 * The snippet a search result gets when it has nothing better to show.
 *
 * Kept apart from content-parser.ts, which re-exports it, so that a module
 * that needs only this does not load cheerio and Turndown with it.
 * provider-results.ts gives a SearchProvider result without a snippet this
 * one, and toc-service.ts, which imports provider-results.ts for a
 * TocProvider's answer, parses no HTML.
 */

/**
 * The snippet `cleanSnippet` falls back to when the excerpt is too short to
 * say anything: the title, and the product the result is shown under.
 *
 * Exported so that a caller which changes the product a result is shown under
 * can recognise this form and rebuild it, rather than leave the snippet naming
 * a different product from the result's own `product` field.
 */
export function titleProductSnippet(title: string, product: string | null): string {
  const productSuffix =
    product !== null && product !== '' ? ` — ${product}` : '';
  return `${title}${productSuffix}`;
}
