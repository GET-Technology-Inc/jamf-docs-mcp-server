/**
 * A suggestion from a search with no results runs under the search's topic
 * and language, and without its product, version and docType.
 *
 * #377 ran a suggestion in the search's language and dropped every other
 * filter. `topic` cannot be why a search found nothing: the server applies it
 * to what Fluid Topics found, and sets it aside, saying so, when it would
 * leave nothing. So it only narrows a suggestion to the topic the search was
 * about: live on 2026-09-28, "sso" in Jamf Teacher under the topic `sso`
 * found nothing and suggested "authentication", which has 10 results under
 * the topic and 50 without.
 *
 * `product`, `version` and `docType` are searched under by Fluid Topics, and
 * can be why nothing was found; the suggestions are words, made without
 * asking what the documentation under them has. Live that day, 12
 * suggestions from 8 searches with no results under a product found nothing
 * in 8 cases under all of the search's filters, in 6 under its product
 * alone, and in none under none of them. "FileVault escrow" in Jamf Pro 10.1.0
 * suggested "encryption": 0 results in Jamf Pro 10.1.0, 49 in Jamf Pro, 50
 * in all. So they stay dropped.
 *
 * Asserted against `suggestionArgs` itself, which lives in `app-ui/search.ts`
 * because importing app.ts throws outside a browser, and then against the
 * built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { suggestionArgs } from '../../../app-ui/search.js';
import { bundleSource, bundledFunction } from '../../helpers/app-bundle.js';

/** A search with no results, under every filter it can have. */
const SEARCH = {
  filters: { product: 'jamf-pro', topic: 'remote-access', version: '11.32.0', docType: 'documentation', language: 'ja-JP' },
};

describe('the arguments that run a suggestion', () => {
  it('keep the search\'s topic and language, and drop its product, version and docType', () => {
    expect(suggestionArgs(SEARCH, 'remote')).toEqual({ query: 'remote', topic: 'remote-access', language: 'ja-JP' });
  });

  it('keep the topic of a search in the default language', () => {
    expect(suggestionArgs({ filters: { product: 'jamf-pro', topic: 'filevault' } }, 'encryption'))
      .toEqual({ query: 'encryption', topic: 'filevault' });
  });

  it('read a malformed topic as none', () => {
    // The payload is cast, not validated: see classify in app.ts.
    for (const topic of [null, '', 7, ['filevault'], {}]) {
      expect(suggestionArgs({ filters: { topic } }, 'encryption')).toEqual({ query: 'encryption' });
    }
  });
});

describe('the built bundle', () => {
  it('runs a suggestion under the search\'s topic and language', () => {
    // app.ts: `call('jamf_docs_search', suggestionArgs(…, search), true, search)`.
    const runs: ts.CallExpression[] = [];
    const walk = (node: ts.Node): void => {
      const first = ts.isCallExpression(node) ? node.arguments.at(0) : undefined;
      if (ts.isCallExpression(node) && first !== undefined && ts.isStringLiteral(first) && first.text === 'jamf_docs_search') {
        runs.push(node);
      }
      ts.forEachChild(node, walk);
    };
    walk(bundleSource());
    expect(runs).toHaveLength(1);
    const built = runs.at(0)?.arguments.at(1);
    expect(built !== undefined && ts.isCallExpression(built) && ts.isIdentifier(built.expression)).toBe(true);
    const run = bundledFunction(((built as ts.CallExpression).expression as ts.Identifier).text) as
      (view: unknown, suggestion: string) => unknown;
    expect(JSON.parse(JSON.stringify(run(SEARCH, 'remote'))))
      .toEqual({ query: 'remote', topic: 'remote-access', language: 'ja-JP' });
  });
});
