/**
 * The host's locale, as a `language` the tools take.
 *
 * The App sends it only where it opens an article (see `openArticle` in
 * app.ts and `articleArgs` in search.ts). A call that continues what is on
 * screen, the next page of a search or a table of contents, or a suggestion
 * from a search with no results, is sent in that view's language, which its
 * arguments carry: see `call` in app.ts.
 *
 * It also holds what the article view says about the language a page is
 * shown in, which compares the language of the page with the one it was
 * asked for in.
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
 * src/core/apps/generated/app-html.ts (`npm run build:app-ui`). The dev
 * harness reloads for it too (scripts/dev-app-ui.mjs).
 */
export const TOOL_LOCALES: ReadonlySet<string> = new Set(SUPPORTED_LOCALE_IDS);

/** A tag's language, script and region, with the likely ones filled in, or undefined for no tag. */
function likely(tag: string): Intl.Locale | undefined {
  try {
    const locale = new Intl.Locale(tag);
    // "und" is no language: its likely one, English, is a guess, not the
    // host's. Read off `baseName`, as `language` is undefined for it in some
    // engines (Node 24's).
    return /^und(?:-|$)/.test(locale.baseName) ? undefined : locale.maximize();
  } catch {
    // Not a BCP 47 tag: `new Intl.Locale` throws a RangeError.
    return undefined;
  }
}

/**
 * The tool locale a BCP 47 tag is read as, or undefined when none is.
 *
 * Matched by language and script, the likely ones where the tag leaves them
 * out, as CLDR gives them: `ja` is `ja-Jpan-JP`, `zh-Hant` and `zh-HK` are
 * written in Traditional Chinese as `zh-TW` is, and `zh` and `zh-SG` in
 * Simplified, as `zh-CN` is. Of the tool locales in that language and
 * script, the one in the tag's region, or else the only one; when there are
 * several and none is in its region, none, rather than a guess. So `en-GB`
 * is read as `en-US` and `pt-PT` as `pt-BR`, which is nearer than the English
 * the server answers with when no `language` is sent.
 *
 * Until 2026-09-28 a tag was matched as the tools spell it, so a host in
 * `ja`, `en-GB` or `zh-Hant-TW` sent no `language`, and an article it opened
 * came in the language of its url: live that day, the en-US search result
 * "Smart Groups" opened as "Smart Groups" there, and as "スマートグループ" and
 * "智慧型群組" with `ja-JP` and `zh-TW`. Matched against `TOOL_LOCALES`
 * unless told otherwise (`among`), so a locale the tools come to take is
 * matched with no list here to change.
 */
export function toolLocale(tag: unknown, among: Iterable<string> = TOOL_LOCALES): string | undefined {
  if (typeof tag !== 'string') {
    return undefined;
  }
  const ids = [...among];
  // A tag spelled as a tool locale is that one, read with no `Intl.Locale`,
  // which a WebView old enough may lack: every tag is then none but these.
  if (ids.includes(tag)) {
    return tag;
  }
  const wanted = likely(tag);
  if (wanted === undefined) {
    return undefined;
  }
  const alike = ids.filter((id) => {
    const tool = likely(id);
    return tool?.language === wanted.language && tool.script === wanted.script;
  });
  return alike.find((id) => likely(id)?.region === wanted.region) ?? (alike.length === 1 ? alike[0] : undefined);
}

/** The host's locale as a tool locale ({@link toolLocale}), or undefined. */
export function hostLanguage(locale: unknown): string | undefined {
  return toolLocale(locale);
}

/**
 * What the article view says about the language a page is shown in, or
 * nothing.
 *
 * `contentLocale` is the language the page is in, where the server says it:
 * a learn.jamf.com topic's `ft:locale`, a concepts.jamf.com or
 * support.jamf.com page's edition (#378), or an `ArticleProvider`'s.
 * `requested` is the language the call that fetched the page asked for: the
 * `language` it sent, or else the locale its url names (see `asked` in
 * app.ts). The panel sends the host's locale when it opens an article
 * itself, and the model sends what it chooses. The page is in another
 * language than asked for when Jamf publishes none of it in that one, or,
 * rarely, when that edition could not be read; the note the server ends the
 * page with says which.
 *
 * On a host whose locale is none the tools take (`ko-KR`), every page is in
 * another language than the reader's, and nothing can ask for theirs, which
 * the view says whatever the call asked for.
 *
 * Until 2026-09-28 the view compared `contentLocale` with the host's locale
 * as the host spells it, so a host in `en-GB` was told an en-US page was not
 * in its language, and a page the model asked for in ja-JP, and got in
 * ja-JP, was said to be untranslated on any other host. A host whose locale
 * the tools do not take was told "Jamf publishes no translation for your
 * locale", which is untrue of a concepts.jamf.com page in `ko` or `pl`: the
 * site publishes both, and no `language` value names either.
 */
export function translationNote(contentLocale: unknown, requested: unknown, hostLocale: unknown): string | undefined {
  if (typeof contentLocale !== 'string' || contentLocale === '') {
    return undefined;
  }
  const reader = hostLanguage(hostLocale);
  if (typeof hostLocale === 'string' && reader === undefined) {
    return `Shown in ${contentLocale} — no translation for your locale is available here.`;
  }
  const asked = toolLocale(requested);
  if (asked === undefined || toolLocale(contentLocale) === asked) {
    return undefined;
  }
  return asked === reader
    ? `Shown in ${contentLocale} — Jamf publishes no translation for your locale.`
    : `Shown in ${contentLocale} — Jamf publishes no ${asked} translation.`;
}
