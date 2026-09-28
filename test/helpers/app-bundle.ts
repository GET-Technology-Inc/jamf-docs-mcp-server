/**
 * The generated MCP App bundle, taken apart the way the app tests read it.
 *
 * `occurrences` and `inlinedScript` were in app-html.test.ts, and the pattern
 * of the "Show more" click handler in app-search-paging.test.ts, until
 * 2026-09-28, when app-toc-paging.test.ts needed both as well. `bundledFunction`
 * was in app-toc-paging.test.ts until the same day, when the tests of what a
 * suggestion and a table-of-contents row send needed it too.
 *
 * The document is scanned with plain string operations over a lower-cased
 * copy rather than with regular expressions. HTML tag syntax has more slack
 * than a pattern comfortably expresses — `<SCRIPT>`, `</script >` — and a
 * matcher that quietly misses a spelling would report a well-formed document
 * without having looked at the one that matters. The click handler is minified
 * JavaScript, not markup, so it is matched with a pattern.
 */

import vm from 'node:vm';
import ts from 'typescript';

import { APP_HTML } from '../../src/core/apps/generated/app-html.js';

const LOWER = APP_HTML.toLowerCase();

/** Every index at which `needle` occurs in the lower-cased document. */
export function occurrences(needle: string): number[] {
  const found: number[] = [];
  for (let i = LOWER.indexOf(needle); i !== -1; i = LOWER.indexOf(needle, i + 1)) {
    found.push(i);
  }
  return found;
}

/**
 * The contents of the single inlined `<script>` element.
 *
 * The bundle escapes its own `</script>` occurrences as `<\/script>`, so the
 * document contains exactly one opening and one closing tag and the span
 * between them is the whole script.
 */
export function inlinedScript(): string {
  const opens = occurrences('<script');
  const closes = occurrences('</script');
  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(
      `expected exactly one script element, found ${String(opens.length)} open `
      + `and ${String(closes.length)} close tag(s)`,
    );
  }

  // Skip past the rest of the opening tag, and stop at the start of the
  // closing one — which may be spelled `</script >`.
  const bodyStart = APP_HTML.indexOf('>', opens[0] ?? 0) + 1;
  const bodyEnd = closes[0] ?? -1;
  if (bodyStart === 0 || bodyEnd < bodyStart) {
    throw new Error('APP_HTML script element is malformed');
  }
  return APP_HTML.slice(bodyStart, bodyEnd);
}

/**
 * The `data-more` click handler in app.ts, as esbuild minifies it:
 *
 *     if (target.closest('button[data-more]') !== null) {
 *       const next = current !== null ? pageArgs(current) : null;
 *       if (next !== null) { void call(next.name, next.args, true); }
 *
 * esbuild renames identifiers but keeps property names and string literals,
 * so the shape is recognisable. The second group is the name it gives
 * `pageArgs`.
 */
const DATA_MORE_CLICK =
  /"button\[data-more\]"\)!==null\)\{let ([\w$]+)=[\w$]+!==null\?([\w$]+)\([\w$]+\):null;\1!==null&&[\w$]+\(\1\.name,\1\.args,!0\)/;

/**
 * The bundle's name for the function whose result a click on "Show more"
 * sends: `pageArgs` in app.ts. Throws, saying what it looked for, when the
 * bundle has no click handler of that shape, whether because the handler
 * changed or because esbuild now minifies it differently.
 */
export function showMoreArgsFunction(): string {
  const name = DATA_MORE_CLICK.exec(APP_HTML)?.[2];
  if (name === undefined) {
    throw new Error(
      'The built bundle has no "Show more" click handler that sends what a function of the view on screen '
      + 'returns (app.ts: `const next = current !== null ? pageArgs(current) : null; '
      + 'if (next !== null) { void call(next.name, next.args, true); }`). If app.ts or esbuild changed its '
      + 'shape, update DATA_MORE_CLICK in test/helpers/app-bundle.ts.',
    );
  }
  return name;
}

let parsed: ts.SourceFile | undefined;

/** The inlined script, parsed once: it is 380 kB, and several tests walk it. */
export function bundleSource(): ts.SourceFile {
  parsed ??= ts.createSourceFile('app.js', inlinedScript(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return parsed;
}

/**
 * The statements of the scope the bundle declares `name` in: the first block,
 * walking from the top, with a function declaration of that name. esbuild
 * hoists every module into the one scope of its IIFE, which is an ancestor
 * of every other block, so a top-level name is found there before a nested
 * function that reuses it.
 */
function scopeOf(name: string): readonly ts.Statement[] | undefined {
  let scope: readonly ts.Statement[] | undefined;
  const findScope = (node: ts.Node): void => {
    if (scope !== undefined) { return; }
    if ((ts.isBlock(node) || ts.isSourceFile(node))
      && node.statements.some(s => ts.isFunctionDeclaration(s) && s.name?.text === name)) {
      scope = node.statements;
      return;
    }
    ts.forEachChild(node, findScope);
  };
  findScope(bundleSource());
  return scope;
}

/** The declaration of the function the bundle names `name`, or undefined. */
export function bundledDeclaration(name: string): ts.FunctionDeclaration | undefined {
  return scopeOf(name)?.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
}

/**
 * The names of the functions the bundle declares whose source contains
 * `text`, a string literal or property name esbuild keeps as it is.
 */
export function bundledFunctionsContaining(text: string): string[] {
  const names: string[] = [];
  const file = bundleSource();
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.getText(file).includes(text)) {
      names.push(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return names;
}

/**
 * The function the bundle declares as `name`, run from the bundle itself: its
 * declaration and those of the functions and variables it names, from the
 * scope it is declared in, evaluated in a context of their own. Each variable
 * is taken on its own, not with the others declared beside it, which may
 * reach for the DOM. None of the functions the tests take this way touches
 * the DOM, so no browser is needed to run them, only to run the whole bundle.
 */
export function bundledFunction(name: string): unknown {
  const file = bundleSource();
  const scope = scopeOf(name);
  if (scope === undefined) {
    throw new Error(
      `The built bundle has no function declaration named ${name}: esbuild may now emit it as an expression `
      + 'or inline it.',
    );
  }
  const declared = new Map<string, { node: ts.Node; source: string }>();
  for (const statement of scope) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declared.set(statement.name.text, { node: statement, source: statement.getText(file) });
    }
    if (ts.isVariableStatement(statement)) {
      for (const variable of statement.declarationList.declarations) {
        if (ts.isIdentifier(variable.name)) {
          declared.set(variable.name.text, { node: variable, source: `var ${variable.getText(file)};` });
        }
      }
    }
  }
  // Everything of that scope the body names, and everything that names. A
  // name that is only a property or a shadowing local adds a declaration
  // nothing uses, which is harmless unless it runs something, and the
  // functions taken this way name nothing that does.
  const needed = new Set<string>();
  const need = (id: string): void => {
    const declaration = declared.get(id);
    if (declaration === undefined || needed.has(id)) { return; }
    needed.add(id);
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) { need(node.text); }
      ts.forEachChild(node, walk);
    };
    walk(declaration.node);
  };
  need(name);
  // In the order the bundle declares them: a variable's initializer can read
  // another variable, which has to be set first.
  const source = [...needed]
    .map(id => declared.get(id))
    .filter(declaration => declaration !== undefined)
    .sort((a, b) => a.node.pos - b.node.pos)
    .map(declaration => declaration.source)
    .join('\n');
  return vm.runInNewContext(`${source}\n${name}`);
}
