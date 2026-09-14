/**
 * Live contract tests for support.jamf.com, the Intercom Help Center.
 *
 * This source shipped in 5.8.0 with no live coverage at all — only unit tests
 * against handcrafted fixtures. Those fixtures were written from a reading of
 * the payload that had missed three block types, so they reproduced the gap
 * instead of catching it, and `table`, `subheading3` and `video` were dropped
 * or flattened for months while every test passed. A fourth, `summary`
 * arriving as a block rather than a string, put "[object Object]" where 18
 * articles' section titles belonged.
 *
 * Nothing here asserts a count that Jamf publishing an article would move.
 * What it pins is structure: the payload is where the reader looks for it,
 * the fields the reader reads exist, and — the assertion this file is really
 * for — every block type in the live corpus is one the renderer handles.
 *
 * Cost, measured 2026-09-14: 1 home page (~1.2s), 9 collection pages (~2.6s
 * each), and SAMPLE_SIZE articles (~0.9s each), at CONCURRENCY at a time.
 * Roughly 40s wall clock against the job's 5-minute timeout.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as cheerio from 'cheerio';
import {
  parseNextData,
  renderBlock,
  renderBlocks,
  HANDLED_BLOCK_TYPES,
} from '../../src/core/services/intercom-service.js';

const SUPPORT_BASE = 'https://support.jamf.com';
const LOCALE = 'en';

/**
 * How many articles to open.
 *
 * Sampled by an even stride over every article the collections list, so all
 * nine are represented rather than whichever happens to sort first. `table`
 * appears in 33 of the 817 live articles and `video` in 2, so no affordable
 * sample sees every rare type every week — which is why the assertions are
 * written over "the types this run saw" rather than over an expected list.
 */
const SAMPLE_SIZE = 60;
const CONCURRENCY = 4;

interface Block {
  type?: string;
  text?: string;
  url?: string;
  id?: string;
  items?: Block[];
  content?: Block[];
  rows?: { cells?: { content?: Block[] }[] }[];
  summary?: unknown;
}

interface Article {
  url: string;
  title?: unknown;
  blocks: Block[];
}

async function getHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'jamf-docs-mcp-server contract check' },
  });
  expect(response.status, `GET ${url}`).toBe(200);
  return await response.text();
}

/** `props.pageProps`, via the same parser the service uses. */
function pageProps(html: string, url: string): Record<string, unknown> {
  const data = parseNextData(html);
  expect(data, `__NEXT_DATA__ on ${url}`).not.toBeNull();
  const props = (data?.props as { pageProps?: Record<string, unknown> } | undefined)?.pageProps;
  expect(props, `props.pageProps on ${url}`).toBeTypeOf('object');
  return props ?? {};
}

/** Every `articleSummaries[].url` anywhere in a collection page's payload. */
function articleUrls(props: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) { return; }
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.articleSummaries)) {
      for (const summary of record.articleSummaries) {
        const { url } = summary as { url?: unknown };
        if (typeof url === 'string' && url !== '') { found.push(url); }
      }
    }
    Object.values(record).forEach(walk);
  };
  walk(props);
  return found;
}

/** Run `work` over `items`, at most CONCURRENCY at a time, keeping order. */
async function mapLimit<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await work(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Every block that reaches {@link renderBlock}, by the paths that reach it.
 *
 * List items and table cells hold block arrays of their own, and a type that
 * only ever appears nested is exactly as capable of being dropped as one at
 * the top level — `subheading3` occurs in all four positions.
 */
function reachableBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      out.push(block);
      walk(block.content ?? []);
      for (const item of block.items ?? []) { walk(item.content ?? []); }
      for (const row of block.rows ?? []) {
        for (const cell of row.cells ?? []) { walk(cell.content ?? []); }
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * True when a block carries something a reader would miss.
 *
 * A paragraph whose text is only whitespace is a spacer — there are 4,478 of
 * them live — and rendering it to nothing is right. One whose text is only an
 * `<img>` is not a spacer: the image is the whole block.
 *
 * Parsed rather than regex-stripped. `text.replace(/<[^>]+>/g, '')` leaves
 * behind anything that does not close cleanly, so it answers "is there
 * visible text" wrongly for exactly the malformed markup worth noticing —
 * and this predicate decides whether a block is allowed to render to nothing.
 */
function hasContent(block: Block): boolean {
  const $ = cheerio.load(`<div>${block.text ?? ''}</div>`);
  return $('div').text().trim() !== ''
    || $('img[src], a[href]').length > 0
    || (block.url ?? '') !== ''
    || (block.id ?? '') !== ''
    || (block.items ?? []).length > 0
    || (block.content ?? []).length > 0
    || (block.rows ?? []).length > 0;
}

let collections: { url: string; name: unknown; id: unknown }[];
let articles: Article[];

beforeAll(async () => {
  const home = pageProps(await getHtml(`${SUPPORT_BASE}/${LOCALE}/`), 'home');
  collections = ((home.home as { collections?: typeof collections } | undefined)?.collections) ?? [];
  expect(collections.length, 'home.collections').toBeGreaterThan(0);

  const perCollection = await mapLimit(collections, async (collection) => {
    const props = pageProps(await getHtml(collection.url), collection.url);
    return articleUrls(props);
  });

  const all = [...new Set(perCollection.flat())];
  expect(all.length, 'articles listed across all collections').toBeGreaterThan(SAMPLE_SIZE);

  const stride = Math.max(1, Math.floor(all.length / SAMPLE_SIZE));
  const sample = all.filter((_, i) => i % stride === 0).slice(0, SAMPLE_SIZE);

  articles = await mapLimit(sample, async (url) => {
    const props = pageProps(await getHtml(url), url);
    const content = props.articleContent as { blocks?: Block[]; title?: unknown } | undefined;
    return { url, title: content?.title, blocks: content?.blocks ?? [] };
  });
}, 300_000);

describe('support.jamf.com contracts', () => {
  it('serves the home page collections the reader starts from', () => {
    for (const collection of collections) {
      expect(collection.url, JSON.stringify(collection)).toMatch(/^https:\/\/support\.jamf\.com\//);
      expect(typeof collection.name === 'string' && collection.name !== '').toBe(true);
    }
  });

  it('carries every article body in articleContent.blocks', () => {
    const empty = articles.filter(a => a.blocks.length === 0).map(a => a.url);
    expect(empty, 'articles whose blocks array is empty').toEqual([]);
    for (const article of articles) {
      expect(typeof article.title === 'string' && article.title !== '', article.url).toBe(true);
    }
  });

  /**
   * The assertion this file exists for.
   *
   * A new block type costs content silently: `table` rendered to nothing,
   * `subheading3` rendered to an ordinary paragraph. Neither left a trace to
   * notice, so the inventory is checked rather than reviewed.
   */
  it('publishes no block type the renderer has no case for', () => {
    const seen = new Map<string, string>();
    for (const article of articles) {
      for (const block of reachableBlocks(article.blocks)) {
        if (block.type !== undefined && !seen.has(block.type)) {
          seen.set(block.type, article.url);
        }
      }
    }
    expect(seen.size, 'distinct block types in the sample').toBeGreaterThan(5);

    const unhandled = [...seen].filter(([type]) => !HANDLED_BLOCK_TYPES.has(type));
    expect(
      unhandled.map(([type, url]) => `${type} (first seen: ${url})`),
      'block types with no case in renderBlock — add one before this ships',
    ).toEqual([]);
  });

  /**
   * The other half: a type can be handled and still render to nothing if the
   * case reads a field the payload does not carry. `video` had no `text` and
   * no `url`, so the fallback returned '' for a block that was entirely there.
   */
  it('renders every block that carries content to something', () => {
    const lost: string[] = [];
    for (const article of articles) {
      for (const block of reachableBlocks(article.blocks)) {
        if (hasContent(block) && renderBlock(block as never).trim() === '') {
          lost.push(`${block.type ?? '(untyped)'} in ${article.url}`);
        }
      }
    }
    expect([...new Set(lost)], 'blocks that carry content and render to nothing').toEqual([]);
  });

  it('renders every sampled article to a non-empty document', () => {
    const blank = articles
      .filter(a => renderBlocks(a.blocks as never).trim() === '')
      .map(a => a.url);
    expect(blank, 'articles that render blank').toEqual([]);
  });

  /**
   * Code blocks arrive as HTML — 826 `<br>` tags and `&lt;`/`&gt;`/`&amp;`
   * across the live corpus. Copied into a fence verbatim they became one
   * unusable line, which is the worst place for it: a code sample is what a
   * reader came to copy.
   */
  it('leaves no markup inside a rendered code fence', () => {
    const offenders: string[] = [];
    let codeBlocks = 0;
    for (const article of articles) {
      for (const block of reachableBlocks(article.blocks)) {
        if (block.type !== 'code') { continue; }
        codeBlocks++;
        const fenced = renderBlock(block as never);
        if (/<\s*br\s*\/?\s*>/i.test(fenced) || /&(lt|gt|amp);/.test(fenced)) {
          offenders.push(article.url);
        }
      }
    }
    expect(codeBlocks, 'code blocks in the sample').toBeGreaterThan(0);
    expect([...new Set(offenders)], 'articles whose code still carries HTML').toEqual([]);
  });

  /**
   * `summary` is declared as a string and is a block on every live section.
   * Interpolating it produced "**[object Object]**" — the section's title,
   * the one line saying what is folded away.
   */
  it('never renders a stringified object', () => {
    const offenders = articles
      .filter(a => renderBlocks(a.blocks as never).includes('[object Object]'))
      .map(a => a.url);
    expect(offenders, 'articles rendering [object Object]').toEqual([]);
  });

  it('keeps a collapsible summary shaped the way the renderer reads it', () => {
    const sections = articles.flatMap(a =>
      reachableBlocks(a.blocks)
        .filter(b => b.type === 'collapsibleSection')
        .map(b => ({ url: a.url, summary: b.summary })));
    for (const { url, summary } of sections) {
      const shape = typeof summary === 'string'
        || (typeof summary === 'object' && summary !== null
          && typeof (summary as { text?: unknown }).text === 'string');
      expect(shape, `collapsibleSection summary in ${url}: ${JSON.stringify(summary)}`).toBe(true);
    }
  });
});
