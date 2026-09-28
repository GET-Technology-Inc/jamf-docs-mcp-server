/**
 * The MCP App says a page is shown in another language than it was asked
 * for when, and only when, it is.
 *
 * The article view compared `structuredContent.contentLocale` with the
 * host's locale as the host spells it. The tools take eleven locales, and a
 * host's can be any BCP 47 tag, so on a host in `en-GB` an en-US page was
 * said to be untranslated, and a page the model asked for in ja-JP, and got
 * in ja-JP, was said to be untranslated on every host but a `ja-JP` one.
 * `contentLocale` is set on every concepts.jamf.com and support.jamf.com
 * page since #378: live on 2026-09-28, "Get Started with Jamf Now"
 * (support.jamf.com) is `contentLocale: "en-US"` asked for in en-US, in
 * ja-JP and in no language, and Jamf publishes no ja-JP edition of it.
 *
 * The view now compares `contentLocale` with the language the call asked
 * for: the `language` it sent, which the panel sends when it opens an
 * article and the host announces before the model's call runs, or else the
 * locale its url names. A call that names a `mapId` + `contentId` pair asks
 * for neither, since `language` has no effect on a pair. On a host whose
 * locale the tools do not take, it says that none for it is available here.
 *
 * Asserted against `translationNote` itself, which lives in
 * `app-ui/language.ts` because importing app.ts throws outside a browser,
 * and then against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { hostLanguage, translationNote } from '../../../app-ui/language.js';
import { urlLocale } from '../../../app-ui/search.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { bundleSource, bundledFunction, bundledFunctionsContaining } from '../../helpers/app-bundle.js';

const YOURS = 'Shown in en-US — Jamf publishes no translation for your locale.';
const NONE_HERE = 'Shown in en-US — no translation for your locale is available here.';

describe('what the article view says about the language a page is shown in', () => {
  it('is nothing when the page is in the language the panel asked for it in', () => {
    // The panel opens an article in `hostLanguage(locale)`: en-US on en-GB.
    for (const host of ['en-US', 'en-GB', 'en']) {
      expect(translationNote('en-US', hostLanguage(host), host)).toBeUndefined();
    }
    expect(translationNote('zh-TW', hostLanguage('zh-Hant-TW'), 'zh-Hant-TW')).toBeUndefined();
  });

  it('is nothing when the page is in the language the model asked for, whatever the host\'s', () => {
    for (const host of ['en-US', 'zh-TW', 'en-GB']) {
      expect(translationNote('ja-JP', 'ja-JP', host)).toBeUndefined();
    }
  });

  it('reads the page\'s language as a tool locale, as it reads the one asked for', () => {
    // An `ArticleProvider` can say its page is in `en` or `en-GB`.
    for (const contentLocale of ['en', 'en-GB', 'en-US']) {
      expect(translationNote(contentLocale, 'en-US', 'en-US')).toBeUndefined();
    }
    expect(translationNote('en-GB', 'ja-JP', 'ja-JP')).toBe('Shown in en-GB — Jamf publishes no translation for your locale.');
  });

  it('says the reader\'s locale has no translation when the page was asked for in it', () => {
    expect(translationNote('en-US', 'ja-JP', 'ja-JP')).toBe(YOURS);
    expect(translationNote('en-US', 'ja-JP', 'ja')).toBe(YOURS);
  });

  it('names the language asked for when it is not the reader\'s', () => {
    expect(translationNote('en-US', 'ja-JP', 'en-US'))
      .toBe('Shown in en-US — Jamf publishes no ja-JP translation.');
  });

  it('says none for the reader\'s locale is available here, on a host whose locale the tools do not take', () => {
    // Whatever the call asked for: the reader's language cannot be. Until
    // 2026-09-28 it said "Jamf publishes no translation for your locale",
    // which is untrue of a concepts.jamf.com page in `ko` or `pl`.
    for (const requested of ['en-US', 'ja-JP', undefined]) {
      expect(translationNote('en-US', requested, 'ko-KR')).toBe(NONE_HERE);
      expect(translationNote('en-US', requested, 'und')).toBe(NONE_HERE);
    }
    expect(translationNote(undefined, 'en-US', 'ko-KR')).toBeUndefined();
  });

  it('is nothing when no language was asked for, or the page does not say its own', () => {
    // Neither a `language` nor a url that names one (see `asked` in app.ts).
    expect(translationNote('ja-JP', undefined, 'en-US')).toBeUndefined();
    // The payload is cast, not validated: see classify in app.ts.
    for (const contentLocale of [undefined, null, '', 7, ['en-US']]) {
      expect(translationNote(contentLocale, 'ja-JP', 'ja-JP')).toBeUndefined();
    }
  });
});

describe('the language a url names, which a call with no `language` asks for', () => {
  it('is the locale in a learn.jamf.com url\'s path', () => {
    expect(urlLocale('https://learn.jamf.com/r/ja-JP/jamf-pro-documentation-current/Smart_Groups')).toBe('ja-JP');
    expect(urlLocale('https://learn.jamf.com/ja-JP/bundle/jamf-pro-documentation-current/page/Smart_Groups.html'))
      .toBe('ja-JP');
    expect(urlLocale('https://learn.jamf.com/bundle/jamf-pro-documentation-current/page/Smart_Groups.html'))
      .toBeUndefined();
  });

  it('is the server\'s locale for the code a concepts.jamf.com or support.jamf.com url starts with', () => {
    // As `staticLocaleId` in src/core/constants/sources.ts reads it.
    for (const source of Object.values(STATIC_DOC_SOURCES)) {
      for (const [locale, code] of Object.entries(source.locales)) {
        const url = `${source.baseUrl}/${code}/articles/1-a`;
        expect({ url, locale: urlLocale(url) }).toEqual({ url, locale });
      }
      // A code no `language` value names: concepts.jamf.com's `ko` and `pl`.
      for (const code of 'otherLocales' in source ? source.otherLocales : []) {
        expect(urlLocale(`${source.baseUrl}/${code}/guides/a/`)).toBeUndefined();
      }
    }
  });

  it('is none on another site, or for what is not a url', () => {
    expect(urlLocale('https://example.com/ja/articles/1-a')).toBeUndefined();
    for (const url of ['/ja/articles/1-a', '', undefined, 7]) {
      expect(urlLocale(url)).toBeUndefined();
    }
  });
});

/** Every call in the bundle to the function it names `name`. */
function callsTo(name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(bundleSource());
  return found;
}

/** The function declaration `node` is in, if any. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      return current;
    }
  }
  return undefined;
}

describe('the built bundle', () => {
  it('says so from translationNote, of the page\'s language, the one asked for and the host\'s', () => {
    // app.ts: `notice(translationNote(view.contentLocale, language, env.locale))`
    // in `articleHeader`. Until 2026-09-28 it was
    // `view.contentLocale !== env.locale ? notice(…) : ''`.
    const notes = bundledFunctionsContaining('publishes no translation for your locale');
    expect(notes).toHaveLength(1);
    const note = bundledFunction(notes[0] ?? '') as typeof translationNote;
    expect(note('en-US', 'en-US', 'en-GB')).toBeUndefined();
    expect(note('ja-JP', 'ja-JP', 'en-US')).toBeUndefined();
    expect(note('en-US', 'ja-JP', 'ja-JP')).toBe(YOURS);
    expect(note('en-GB', 'en-US', 'en-US')).toBeUndefined();
    expect(note('en-US', undefined, 'ko-KR')).toBe(NONE_HERE);

    const uses = callsTo(notes[0] ?? '');
    expect(uses).toHaveLength(1);
    const use = uses.at(0);
    const args = use?.arguments.map(arg => arg.getText()) ?? [];
    expect(args[0]).toMatch(/^[\w$]+\.contentLocale$/);
    expect(args[2]).toMatch(/^[\w$]+\.locale$/);
    // The second is the header's third parameter: the view's `language`.
    const header = use !== undefined ? enclosingFunction(use) : undefined;
    expect(args[1]).toBe(header?.parameters[2]?.name.getText());
    expect(APP_HTML).not.toMatch(/\.contentLocale!==[\w$]+\.locale/);
  });

  it('reads the language a page was asked for off the call that fetched it', () => {
    // app.ts: `asked(view, args)`, which puts the language `args` asked for
    // on an article.
    const askers = bundledFunctionsContaining('"article"').filter(name => {
      try {
        const asked = bundledFunction(name) as (view: unknown, args: unknown) => unknown;
        const view = asked({ kind: 'article', data: {} }, { language: 'ja-JP' }) as { language?: unknown };
        return view.language === 'ja-JP';
      } catch {
        return false;
      }
    });
    expect(askers).toHaveLength(1);
    const asked = bundledFunction(askers[0] ?? '') as (view: unknown, args: unknown) => Record<string, unknown>;
    const article = { kind: 'article', data: {} };
    expect(asked(article, {})).toEqual(article);
    expect(asked(article, undefined)).toEqual(article);
    expect(asked({ kind: 'search', data: {} }, { language: 'ja-JP' })).toEqual({ kind: 'search', data: {} });

    // With no `language`, the locale its url names. Live on 2026-09-28, the
    // support.jamf.com `/ja/` url of "Get Started with Jamf Now", which has
    // no ja edition, came back in en-US.
    const support = 'https://support.jamf.com/ja/articles/10631322-get-started-with-jamf-now';
    expect(asked(article, { url: support })).toEqual({ ...article, language: 'ja-JP' });
    expect(asked(article, { url: support, language: 'en-US' })).toEqual({ ...article, language: 'en-US' });
    const learn = 'https://learn.jamf.com/r/ja-JP/jamf-pro-documentation-current/Smart_Groups';
    expect(asked(article, { url: learn })).toEqual({ ...article, language: 'ja-JP' });
    expect(asked(article, { url: 'https://concepts.jamf.com/ko/guides/ai-governance/' })).toEqual(article);

    // A `mapId` + `contentId` pair is a topic of one map, in its one
    // language, and `language` has no effect on it: nothing was asked for.
    const pair = { mapId: 'm~1', contentId: 'c~1' };
    expect(asked(article, { ...pair, language: 'ja-JP' })).toEqual(article);
    expect(asked(article, { ...pair, url: learn, language: 'ja-JP' })).toEqual(article);
    expect(asked(article, { mapId: 'm~1', language: 'ja-JP' })).toEqual({ ...article, language: 'ja-JP' });

    // Of the arguments `call` sent, and of those the host announced for the
    // model's call: `asked(view, args)` in `call`, and
    // `asked(view, toolArguments)` in `ontoolresult`, where `ontoolinput`
    // set `toolArguments = params.arguments ?? {}`.
    const uses = callsTo(askers[0] ?? '');
    expect(uses).toHaveLength(2);
    const byCall = uses.find(use => {
      const fn = enclosingFunction(use);
      return fn !== undefined && ts.isFunctionDeclaration(fn)
        && fn.getText().includes('callServerTool')
        && use.arguments.at(1)?.getText() === fn.parameters.at(1)?.name.getText();
    });
    expect(byCall).toBeDefined();
    const byResult = uses.find(use => use !== byCall);
    const announced = byResult?.arguments[1]?.getText() ?? '';
    // The name `ontoolinput` stores the arguments in is read off the bundle
    // and compared, not written into a pattern.
    const stored = /\.ontoolinput=[\w$]+=>\{let ([\w$]+)=[\w$]+\.arguments\?\?\{\};([\w$]+)=\1[;,]/.exec(APP_HTML);
    expect(stored?.[2]).toBeDefined();
    expect(stored?.[2]).toBe(announced);
  });
});
