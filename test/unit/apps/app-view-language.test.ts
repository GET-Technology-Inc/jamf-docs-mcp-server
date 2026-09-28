/**
 * What the MCP App asks for from a view it is showing is asked for in that
 * view's language, not the host's.
 *
 * `call` in app.ts sent every call's arguments as `{ ...args, ...toolLanguage() }`,
 * so the host's locale, when it was one the tools take, replaced whatever
 * `language` the arguments carried, and was added where they carried none.
 * "Show more" on a search or a table of contents then asked for the next
 * page of another language's search or tree. Live on 2026-09-28: the Jamf Pro
 * TOC in ja-JP at `maxTokens: 1000` holds "Jamf Proドキュメント" to "システム設定"
 * on page 1, and on an en-US host "Show more" got page 2 of the en-US tree,
 * "System Settings", again, in English; the en-US TOC on a ja-JP host got
 * "グローバル管理設定" and "Jamf App の統合", and never showed "System Settings".
 * A suggestion from a search with no results ran as `{ query }` plus the
 * host's language: the zh-TW search "磁碟 加密 復原 金鑰 託管" (Jamf Pro
 * 10.1.0) suggests "磁碟 加密 復原", which has 50 results in zh-TW and none
 * in en-US.
 *
 * Asserted against `suggestionArgs` itself, which lives in `app-ui/search.ts`
 * because importing app.ts throws outside a browser, and then against the
 * built bundle, which is what ships: what `call` sends, what a click on a
 * suggestion sends, what a retry resends, and which call the host's language
 * is added to.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { suggestionArgs } from '../../../app-ui/search.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { bundleSource, bundledFunction } from '../../helpers/app-bundle.js';

describe('the arguments that run a suggestion from a search with no results', () => {
  it('are the suggestion, in the language the search ran in', () => {
    // Nor its product and version: see app-suggestion-filters.test.ts.
    expect(suggestionArgs(
      { filters: { product: 'jamf-pro', version: '10.1.0', language: 'zh-TW' } },
      '磁碟 加密 復原',
    )).toEqual({ query: '磁碟 加密 復原', language: 'zh-TW' });
  });

  it('are the suggestion alone after a search in the default language', () => {
    expect(suggestionArgs({ filters: { product: 'jamf-pro', version: '10.1.0' } }, 'encryption'))
      .toEqual({ query: 'encryption' });
    expect(suggestionArgs({}, 'encryption')).toEqual({ query: 'encryption' });
  });

  it('read a malformed payload as a search in the default language', () => {
    // The payload is cast, not validated: see classify in app.ts.
    for (const filters of [null, 'zh-TW', ['zh-TW'], { language: 7 }, { language: '' }]) {
      expect(suggestionArgs({ filters }, 'encryption')).toEqual({ query: 'encryption' });
    }
  });
});

/** Every call expression in the bundle that `match` accepts. */
function calls(match: (node: ts.CallExpression) => boolean): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && match(node)) {
      found.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(bundleSource());
  return found;
}

/** The function declaration `node` is in, if any. */
function enclosingFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
  let current = node;
  while (!ts.isSourceFile(current)) {
    current = current.parent;
    if (ts.isFunctionDeclaration(current)) {
      return current;
    }
  }
  return undefined;
}

/** The text of a call's first argument, when that is a string literal. */
function firstArgument(node: ts.CallExpression): string | undefined {
  const first = node.arguments.at(0);
  return first !== undefined && ts.isStringLiteral(first) ? first.text : undefined;
}

describe('the built bundle', () => {
  it('sends the arguments a call is given, as they are', () => {
    // app.ts: `app.callServerTool({ name, arguments: args })`, in
    // `call(name, args, …)`. Until 2026-09-28 it sent
    // `{ ...args, ...toolLanguage() }`.
    const sends = calls(node => ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'callServerTool');
    expect(sends).toHaveLength(1);
    const [send] = sends;
    const [request] = send.arguments;
    expect(ts.isObjectLiteralExpression(request)).toBe(true);
    const sent = (request as ts.ObjectLiteralExpression).properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'arguments',
    )?.initializer;
    expect(sent?.getText()).toBe(enclosingFunction(send)?.parameters[1].name.getText());
  });

  it('runs a suggestion with the arguments suggestionArgs builds from the search on screen', () => {
    // app.ts: `call('jamf_docs_search', suggestionArgs(…, search), true, search)`.
    // Until 2026-09-28 it was `call('jamf_docs_search', { query: search }, …)`.
    const runs = calls(node => firstArgument(node) === 'jamf_docs_search');
    expect(runs).toHaveLength(1);
    const built = runs[0].arguments[1];
    expect(ts.isCallExpression(built) && ts.isIdentifier(built.expression)).toBe(true);
    const { expression, arguments: [view] } = built as ts.CallExpression;
    // Of the view on screen when it is a search: the chips are only on one.
    expect(view.getText()).toMatch(/\.kind==="search"\?[\w$]+\.data:/);

    const run = bundledFunction((expression as ts.Identifier).text) as (view: unknown, suggestion: string) => unknown;
    const sentFor = (search: unknown): unknown => JSON.parse(JSON.stringify(run(search, '磁碟 加密 復原')));
    expect(sentFor({ filters: { product: 'jamf-pro', version: '10.1.0', language: 'zh-TW' } }))
      .toEqual({ query: '磁碟 加密 復原', language: 'zh-TW' });
    expect(sentFor({ filters: { product: 'jamf-pro' } })).toEqual({ query: '磁碟 加密 復原' });
  });

  it('adds the host\'s language only to what opens an article', () => {
    // app.ts: `const forwarded = toolLanguage()`, then
    // `call('jamf_docs_get_article', { ...articleArgs(…), ...forwarded }, …)`.
    // The rest of that call is app-search-open.test.ts's.
    expect(APP_HTML).toMatch(/"jamf_docs_get_article",\{\.\.\.[\w$]+\(\{url:[\w$]+,mapId:[\w$]+,contentId:[\w$]+\},([\w$]+)\.language\),\.\.\.\1\},!0,/);
    const opens = calls(node => firstArgument(node) === 'jamf_docs_get_article');
    expect(opens).toHaveLength(1);
    const spread = (opens[0].arguments[1] as ts.ObjectLiteralExpression).properties.at(-1);
    expect(spread !== undefined && ts.isSpreadAssignment(spread) && ts.isIdentifier(spread.expression)).toBe(true);
    const forwarded = ((spread as ts.SpreadAssignment).expression as ts.Identifier).text;
    let toolLanguage: string | undefined;
    const findDeclaration = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === forwarded
        && node.initializer !== undefined && ts.isCallExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression) && node.initializer.arguments.length === 0) {
        toolLanguage = node.initializer.expression.text;
        return;
      }
      ts.forEachChild(node, findDeclaration);
    };
    findDeclaration(enclosingFunction(opens[0]) ?? bundleSource());
    expect(toolLanguage).toBeDefined();
    // And nowhere else: not "Show more", a suggestion or a retry. Until
    // 2026-09-28 `call` added it to every one of them.
    expect(calls(node => ts.isIdentifier(node.expression) && node.expression.text === toolLanguage))
      .toHaveLength(1);
  });

  it('retries a failed call with the arguments it sent, as they are', () => {
    // app.ts: `const { name, args, label } = current.retry; void call(name, args, false, label)`.
    // A retry of "Show more" or of a suggestion is asked in the language the
    // failed call was, not the host's.
    const retries: ts.VariableDeclaration[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
        && node.initializer !== undefined && ts.isPropertyAccessExpression(node.initializer)
        && node.initializer.name.text === 'retry') {
        retries.push(node);
      }
      ts.forEachChild(node, walk);
    };
    walk(bundleSource());
    expect(retries).toHaveLength(1);
    const bound = new Map((retries[0].name as ts.ObjectBindingPattern).elements.map(element => [
      element.propertyName?.getText() ?? element.name.getText(),
      element.name.getText(),
    ]));
    const statement = retries[0].parent.parent;
    const block = statement.parent as ts.Block;
    const next = block.statements.at(block.statements.indexOf(statement) + 1);
    const expression = next !== undefined && ts.isExpressionStatement(next) ? next.expression : undefined;
    const retry = expression !== undefined && ts.isVoidExpression(expression) ? expression.expression : expression;
    expect(retry !== undefined && ts.isCallExpression(retry)).toBe(true);
    // The same `call` that sends what it is given (see above).
    const [send] = calls(node => ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'callServerTool');
    const { expression: callee, arguments: args } = retry as ts.CallExpression;
    expect(callee.getText()).toBe(enclosingFunction(send)?.name?.text);
    expect(args.map(arg => arg.getText()).slice(0, 2)).toEqual([bound.get('name'), bound.get('args')]);
  });
});
