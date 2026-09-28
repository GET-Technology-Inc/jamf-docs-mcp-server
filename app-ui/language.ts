/**
 * The host's locale, as a `language` the tools take.
 *
 * The App sends it only where it opens an article (see `openArticle` in
 * app.ts and `articleArgs` in search.ts). A call that continues what is on
 * screen, the next page of a search or a table of contents, or a suggestion
 * from a search with no results, is sent in that view's language, which its
 * arguments carry: see `call` in app.ts.
 *
 * Kept out of app.ts so it can be tested on its own, as toc.ts is: importing
 * app.ts runs its top-level wiring and throws outside a browser.
 */

import { SUPPORTED_LOCALE_IDS } from '../src/core/constants/locales.js';

/**
 * The locales the tools accept: the `language` enum of every tool that has
 * one is built from this same list.
 *
 * `hostContext.locale` is BCP 47 and can be anything; the tool parameter is a
 * closed enum. Forwarding an unlisted locale is a validation error that fails
 * the call, so the App forwards only what the server can accept.
 *
 * Until 2026-09-28 the App kept a list of its own, of eight, and it-IT, pt-BR
 * and zh-CN, which the tools take since #259, were never on it: on a host in
 * one of those, an article opened in English, although Jamf translates the
 * Jamf Parent and Jamf Teacher guides into all three. The bundle is served by
 * the server it calls, so the two lists are now one.
 *
 * So the bundle depends on src/core/constants/locales.ts as well as app-ui/:
 * a change to `SUPPORTED_LOCALES` there means regenerating
 * src/core/apps/generated/app-html.ts (`npm run build:app-ui`), and the dev
 * harness, which watches app-ui/ alone, does not reload for it.
 */
export const TOOL_LOCALES: ReadonlySet<string> = new Set(SUPPORTED_LOCALE_IDS);

/** The host's locale when it is one the tools take, or undefined. */
export function hostLanguage(locale: unknown): string | undefined {
  return typeof locale === 'string' && TOOL_LOCALES.has(locale) ? locale : undefined;
}
