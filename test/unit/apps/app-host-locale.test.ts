/**
 * The MCP App reads the host's locale as the tool locale in its language and
 * script, not only as the tools spell it.
 *
 * `hostContext.locale` is any BCP 47 tag, and the App matched it against the
 * tools' `language` values exactly. A host in `ja`, `en-GB` or `zh-Hant-TW`
 * therefore sent no `language` when it opened an article, and the server
 * answered in the language of its url: live on 2026-09-28, the en-US result
 * "Smart Groups" (`jamf-pro`) opened as "Smart Groups" for such a host, and
 * as "スマートグループ" and "智慧型群組" for `ja-JP` and `zh-TW`. The notice
 * that an article is not in the language asked for is tested in
 * app-translation-note.test.ts.
 *
 * Asserted against `app-ui/language.ts`, which lives apart from app.ts
 * because importing app.ts throws outside a browser, and then against the
 * built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { TOOL_LOCALES, hostLanguage, toolLocale } from '../../../app-ui/language.js';
import { bundleSource, bundledFunction } from '../../helpers/app-bundle.js';

/** Host locales, and the tool locale each is read as. */
const MATCHED: [string, string][] = [
  ['en', 'en-US'],
  ['en-GB', 'en-US'],
  ['en-us', 'en-US'],
  ['en-AU-u-ca-gregory', 'en-US'],
  ['ja', 'ja-JP'],
  ['zh-Hant-TW', 'zh-TW'],
  ['zh-Hant', 'zh-TW'],
  ['zh-HK', 'zh-TW'],
  ['zh-Hans', 'zh-CN'],
  ['zh-Hans-TW', 'zh-CN'],
  ['zh', 'zh-CN'],
  ['zh-SG', 'zh-CN'],
  ['de', 'de-DE'],
  ['de-AT', 'de-DE'],
  ['es-419', 'es-ES'],
  ['fr-CA', 'fr-FR'],
  ['nl-BE', 'nl-NL'],
  ['th', 'th-TH'],
  ['it-CH', 'it-IT'],
  ['pt', 'pt-BR'],
  ['pt-PT', 'pt-BR'],
];

describe('the tool locale a host locale is read as', () => {
  it('is each tool locale for itself', () => {
    for (const locale of TOOL_LOCALES) {
      expect(hostLanguage(locale)).toBe(locale);
    }
  });

  it('is the one in its language and script, in its region or the only one', () => {
    for (const [host, tool] of MATCHED) {
      expect({ host, tool: hostLanguage(host) }).toEqual({ host, tool });
    }
  });

  it('is none for a language the tools do not take, no language, or no tag', () => {
    for (const host of ['ko-KR', 'ko', 'ar', 'ru-RU', 'und', 'und-Latn', '', 'x-private', 'not a tag', undefined, null, 7]) {
      expect({ host, tool: hostLanguage(host) }).toEqual({ host, tool: undefined });
    }
  });

  it('is a tool locale as the tools spell it where there is no Intl.Locale, and none of the others', () => {
    // A WebView old enough may lack it. Until 2026-09-28 the App matched
    // exactly and read none of the others either.
    const { Locale } = Intl;
    Reflect.set(Intl, 'Locale', undefined);
    try {
      for (const locale of TOOL_LOCALES) {
        expect(hostLanguage(locale)).toBe(locale);
      }
      expect(hostLanguage('ja')).toBeUndefined();
      expect(hostLanguage('en-GB')).toBeUndefined();
    } finally {
      Reflect.set(Intl, 'Locale', Locale);
    }
  });

  it('is none when two in its language and script are in other regions than its own', () => {
    // No two tool locales are yet: zh-TW and zh-CN differ in script.
    expect(toolLocale('pt-AO', ['pt-BR', 'pt-PT'])).toBeUndefined();
    expect(toolLocale('pt-PT', ['pt-BR', 'pt-PT'])).toBe('pt-PT');
    // A tag with no region is in its likely one: `pt` is `pt-Latn-BR`.
    expect(toolLocale('pt', ['pt-BR', 'pt-PT'])).toBe('pt-BR');
  });
});

describe('the built bundle', () => {
  it('forwards the tool locale a host locale is read as', () => {
    // app.ts: `toolLanguage()` sends `hostLanguage(env.locale)`, the function
    // that reads `.locale` of the environment and returns the language.
    const readers: string[] = [];
    const walk = (node: ts.Node): void => {
      const first = ts.isCallExpression(node) && node.arguments.length === 1 ? node.arguments.at(0) : undefined;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && first !== undefined && ts.isPropertyAccessExpression(first) && first.name.text === 'locale'
        && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        readers.push(node.expression.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(bundleSource());
    expect(readers).toHaveLength(1);
    const forward = bundledFunction(readers[0] ?? '') as (locale: unknown) => unknown;
    for (const [host, tool] of MATCHED) {
      expect({ host, tool: forward(host) }).toEqual({ host, tool });
    }
    expect(forward('ko-KR')).toBeUndefined();
  });
});
