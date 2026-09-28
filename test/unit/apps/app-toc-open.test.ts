/**
 * A table-of-contents row opens its own article in the MCP App, even where
 * another entry shares its url.
 *
 * The App opened every row with its url alone, as it did search results until
 * #363. Jamf publishes some different topics at one url, and the url fetches
 * only one of them: live on 2026-09-28, the LAPS paper's contents list "Use
 * LAPS" and "Using LAPS in the Jamf Pro API" at `…/Using_LAPS`, which opens
 * the second, and "Enable LAPS" and "Enabling LAPS in the Jamf Pro API" at
 * `…/Implementing_LAPS`, which opens the second too. The Technical Articles
 * contents have 46 such urls, for 178 entries. And some urls open nothing at
 * all: `jamf_docs_get_article` answers "Topic not found" for at least 48 urls
 * in the Jamf Pro, Jamf Connect, Jamf School, Jamf Protect and Technical
 * Articles contents, such as
 * `…/jamf-pro-documentation-current/Configuring-the-Branding-Settings`, and
 * opens each of those by its pair. `jamf_docs_get_toc` returns the
 * map's `mapId` and each entry's `contentId`, which learn.jamf.com fetches
 * by, and a row now carries the pair to the click, as a search result does.
 *
 * Asserted against `renderTocItems` itself, which lives in `app-ui/toc.ts`
 * because importing app.ts throws outside a browser, and then against the
 * built bundle, which is what ships. What the click sends from the pair is
 * `articleArgs`, which app-search-open.test.ts covers.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import { renderTocItems, type TocEntry } from '../../../app-ui/toc.js';
import { bundleSource, bundledFunction, bundledFunctionsContaining } from '../../helpers/app-bundle.js';

/** The LAPS paper's map, and two entries of it at one url (live, 2026-09-28). */
const LAPS_MAP = '1ZN5bkFvUa6baRoUXR6Zog';
const LAPS_ENTRIES: TocEntry[] = [
  {
    title: 'Use LAPS',
    url: 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS',
    contentId: 'cS8N6f3zVb5pvf0xGCi_ug',
    depth: 0,
  },
  {
    title: 'Using LAPS in the Jamf Pro API',
    url: 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS',
    contentId: 'XD_dFGbPnBjOLmq~fF_mSw',
    depth: 1,
  },
];

/** The pair each rendered row carries, in order. */
function pairs(html: string): { mapId?: string; contentId?: string }[] {
  return [...html.matchAll(/<a class="row"[^>]*>/g)].map(([row]) => {
    const mapId = / data-map-id="([^"]*)"/.exec(row)?.[1];
    const contentId = / data-content-id="([^"]*)"/.exec(row)?.[1];
    return { ...(mapId !== undefined ? { mapId } : {}), ...(contentId !== undefined ? { contentId } : {}) };
  });
}

describe('a table-of-contents row', () => {
  it('carries the map and its entry\'s content id, so two entries at one url open two articles', () => {
    expect(pairs(renderTocItems(LAPS_ENTRIES, LAPS_MAP))).toEqual([
      { mapId: LAPS_MAP, contentId: 'cS8N6f3zVb5pvf0xGCi_ug' },
      { mapId: LAPS_MAP, contentId: 'XD_dFGbPnBjOLmq~fF_mSw' },
    ]);
    // And still its url, which opens it when there is no pair.
    expect(renderTocItems(LAPS_ENTRIES, LAPS_MAP)).toContain(
      'data-url="https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS"',
    );
  });

  it('carries no pair from a TOC with no map, such as a concepts.jamf.com or support.jamf.com one', () => {
    expect(pairs(renderTocItems(LAPS_ENTRIES, undefined))).toEqual([{}, {}]);
    expect(pairs(renderTocItems(LAPS_ENTRIES))).toEqual([{}, {}]);
  });

  it('carries no pair for an entry with no content id, or ids the tool would reject', () => {
    const [entry] = LAPS_ENTRIES;
    const rows = [
      { ...entry, contentId: undefined },
      { ...entry, contentId: 'has space' },
      { ...entry, contentId: 7 },
    ] as unknown as TocEntry[];
    expect(pairs(renderTocItems(rows, LAPS_MAP))).toEqual([{}, {}, {}]);
    expect(pairs(renderTocItems(LAPS_ENTRIES, '"><x'))).toEqual([{}, {}]);
  });
});

describe('the built bundle', () => {
  const renderers = bundledFunctionsContaining('<li><a class="row"');

  it('renders each row with its pair', () => {
    expect(renderers).toHaveLength(1);
    const render = bundledFunction(renderers[0] ?? '') as (entries: TocEntry[], mapId?: string) => string;
    expect(pairs(render(LAPS_ENTRIES, LAPS_MAP))).toEqual([
      { mapId: LAPS_MAP, contentId: 'cS8N6f3zVb5pvf0xGCi_ug' },
      { mapId: LAPS_MAP, contentId: 'XD_dFGbPnBjOLmq~fF_mSw' },
    ]);
  });

  it('renders the rows of the TOC on screen with its map', () => {
    // app.ts: `renderTocItems(shown, view.mapId)`. Until 2026-09-28 it was
    // `renderTocItems(shown)`.
    const uses: ts.CallExpression[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === renderers[0]) {
        uses.push(node);
      }
      ts.forEachChild(node, walk);
    };
    walk(bundleSource());
    expect(uses).toHaveLength(1);
    expect(uses[0]?.arguments[1]?.getText()).toMatch(/^[\w$]+\.mapId$/);
  });
});
