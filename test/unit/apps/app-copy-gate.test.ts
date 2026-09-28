/**
 * A code block has a Copy button where the host lets the App write to the
 * clipboard, in an article and in a glossary definition, and nowhere else.
 *
 * `navigator.clipboard.writeText` in a sandboxed iframe without the
 * `clipboardWrite` grant rejects, so a button shown without it is one that
 * does nothing. Until 2026-09-28 the renderer read the grant itself
 * (`env.canCopy` in `readFence`), and nothing tested it. That day the
 * renderer moved to app-ui/markdown.ts, and the grant became an option each
 * call passes: a call that left it out would drop every button without a
 * word, and every test still passed when one did. The option is now
 * required, and each call in the bundle passes the grant.
 *
 * Asserted against `markdown` itself, and then against the built bundle,
 * which is what ships.
 */

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import ts from 'typescript';

import { markdown } from '../../../app-ui/markdown.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { bundleSource, bundledFunction, markdownFunction } from '../../helpers/app-bundle.js';

const FENCE = '```\nsudo jamf recon\n```';
const QUOTED = '> ```\n> sudo jamf recon\n> ```';

/** How many Copy buttons `html` has. */
function buttons(html: string): number {
  return cheerio.load(html, null, false)('button[data-copy]').length;
}

/** That `render` gives a code block a Copy button with the grant, in a quotation too, and none without it. */
function expectGated(render: typeof markdown): void {
  for (const source of [FENCE, QUOTED]) {
    expect({ source, buttons: buttons(render(source, { copy: true })) }).toEqual({ source, buttons: 1 });
    expect({ source, buttons: buttons(render(source, { copy: false })) }).toEqual({ source, buttons: 0 });
  }
}

/** The function declaration `node` is in, if any. */
function declarationOf(node: ts.Node): ts.FunctionDeclaration | undefined {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionDeclaration(current)) {
      return current;
    }
  }
  return undefined;
}

describe('a code block', () => {
  it('has a Copy button when the host grants clipboardWrite, and none when it does not', () => {
    expectGated(markdown);
  });
});

describe('the built bundle', () => {
  const name = markdownFunction();

  it('gives a code block a Copy button as the module does', () => {
    expectGated(bundledFunction(name) as typeof markdown);
  });

  it('passes the host\'s grant from the article and the glossary definition', () => {
    // app.ts: `env.canCopy = app.getHostCapabilities()?.sandbox?.permissions
    // ?.clipboardWrite !== undefined` once connected.
    const grant = /([\w$]+)\.canCopy=[\w$]+\.getHostCapabilities\(\)\?\.sandbox\?\.permissions\?\.clipboardWrite!==void 0/
      .exec(APP_HTML)?.[1];
    expect(grant).toBeDefined();

    const calls: ts.CallExpression[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
        calls.push(node);
      }
      ts.forEachChild(node, walk);
    };
    walk(bundleSource());

    // markdown.ts: `readQuote` renders a quotation's lines with the options
    // it was given, `markdown(body.join('\n'), options)`.
    const joins = (call: ts.CallExpression): boolean => call.arguments.at(0)?.getText().includes('.join(') === true;
    const quoted = calls.filter(joins);
    expect(quoted).toHaveLength(1);
    const inQuote = quoted.at(0);
    const quote = inQuote !== undefined ? declarationOf(inQuote) : undefined;
    expect(quote).toBeDefined();
    expect(inQuote?.arguments.at(1)?.getText()).toBe(quote?.parameters.at(2)?.name.getText());

    // app.ts: `markdown(prose.text, { copy: env.canCopy })` in
    // `renderArticle`, and `markdown(only.definition, { copy: env.canCopy })`
    // in the glossary's single-definition layout.
    const rendered = calls.filter(call => !joins(call));
    expect(rendered.map(call => call.arguments.at(0)?.getText().replace(/^[\w$]+/, '')).sort())
      .toEqual(['.definition', '.text']);
    for (const call of rendered) {
      expect(call.arguments.at(1)?.getText()).toBe(`{copy:${grant ?? ''}.canCopy}`);
    }
  });
});
