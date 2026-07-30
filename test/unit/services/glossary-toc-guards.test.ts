/**
 * Regression tests for the `FtTocNode` guards in `fetchGlossaryToc`.
 *
 * 4.0.1's lint sweep removed `if (node.children && node.children.length > 0)`
 * because `FtTocNode.children` was declared a required `FtTocNode[]`. That type
 * is a bare cast over `response.json()` in `fetchMapToc` with no runtime
 * validation behind it — Fluid Topics omits `children` entirely on a leaf node
 * rather than sending `[]` — so the guard was live, not dead.
 *
 * The failure is quiet rather than loud: `lookupGlossaryTerm` wraps
 * `fetchGlossaryToc` in a try/catch, so the TypeError surfaces as *every*
 * glossary lookup returning zero entries, with one log line, rather than as a
 * crash. One malformed node takes the entire glossary down with it.
 *
 * These tests drive the private `fetchGlossaryToc` through the public
 * `lookupGlossaryTerm` with `ft-client` mocked.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Only the two functions the glossary path calls are replaced; the rest of the
// module stays real because MapsRegistry reaches for `fetchMaps` on construction.
vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import { lookupGlossaryTerm } from '../../../src/core/services/glossary.js';
import { createMockContext } from '../../helpers/mock-context.js';
import type { FtTocNode } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFetchMapToc = vi.mocked(fetchMapToc);
const mockedFetchTopicContent = vi.mocked(fetchTopicContent);

/** A glossary topic page in the DITA shape the parser understands. */
function glossaryHtml(term: string, definition: string): string {
  return `
    <html><body><main role="main">
      <article class="dita" role="article">
        <h1 class="title glossterm topictitle1"><span class="ph">${term}</span></h1>
        <div class="abstract glossdef"><p class="p">${definition}</p></div>
      </article>
    </main></body></html>
  `;
}

/** A well-formed TOC child node. */
function child(title: string, contentId: string): FtTocNode {
  return {
    tocId: `toc-${contentId}`,
    contentId,
    title,
    prettyUrl: `/en-US/bundle/jamf-technical-glossary/page/${contentId}.html`,
    children: [],
  };
}

function makeCtx(): ServerContext {
  const ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue('glossary-map');
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchTopicContent.mockResolvedValue(
    glossaryHtml('Access Token', 'A credential issued after authentication.'),
  );
});

describe('fetchGlossaryToc — nodes missing fields the type declared required', () => {
  it('should skip a root node that has no children key instead of throwing', async () => {
    // The first root arrives without `children` at all — a leaf, in FT's
    // encoding. Reading `.length` on it threw and lost the whole glossary.
    mockedFetchMapToc.mockResolvedValue([
      {
        tocId: 'toc-orphan',
        contentId: 'orphan',
        title: 'Standalone Page',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/orphan.html',
      },
      {
        tocId: 'toc-a',
        contentId: 'group-a',
        title: 'A',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/A.html',
        children: [child('Access Token', 'access-token')],
      },
    ] as FtTocNode[]);

    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Access Token' });

    // The term under the *second* root is still found, which is only possible
    // if the childless first root was skipped rather than fatal.
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].term).toBe('Access Token');
  });

  it('should skip a child with no title and keep its titled siblings', async () => {
    const titleless = {
      tocId: 'toc-notitle',
      contentId: 'no-title',
      prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/no-title.html',
      children: [],
    } as unknown as FtTocNode;

    mockedFetchMapToc.mockResolvedValue([
      {
        tocId: 'toc-a',
        contentId: 'group-a',
        title: 'A',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/A.html',
        children: [titleless, child('Access Token', 'access-token')],
      },
    ] as FtTocNode[]);

    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Access Token' });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].term).toBe('Access Token');
  });

  it('should return a result rather than throwing when every node is malformed', async () => {
    mockedFetchMapToc.mockResolvedValue([
      {
        tocId: 'toc-orphan',
        contentId: 'orphan',
        title: 'Standalone Page',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/orphan.html',
      },
    ] as FtTocNode[]);

    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Access Token' });

    // Nothing to match, but the lookup completes normally.
    expect(result.entries).toHaveLength(0);
    expect(result.totalMatches).toBe(0);
  });

  it('should still match a term through the substring fallback when a sibling has no title', async () => {
    // Exercises the `tocEntries.filter(e => e.title...)` path, which reads
    // `.title` on every entry rather than only on matched ones.
    const titleless = {
      tocId: 'toc-notitle',
      contentId: 'no-title',
      prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/no-title.html',
      children: [],
    } as unknown as FtTocNode;

    mockedFetchMapToc.mockResolvedValue([
      {
        tocId: 'toc-a',
        contentId: 'group-a',
        title: 'A',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/A.html',
        children: [titleless, child('Access Token', 'access-token')],
      },
    ] as FtTocNode[]);

    // A term that fuzzy search will not hit, forcing the substring fallback.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'ccess Tok' });

    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('should drop the "Revision History" entry as before', async () => {
    mockedFetchMapToc.mockResolvedValue([
      {
        tocId: 'toc-a',
        contentId: 'group-a',
        title: 'A',
        prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/A.html',
        children: [
          child('Glossary Revision History', 'revision-history'),
          child('Access Token', 'access-token'),
        ],
      },
    ] as FtTocNode[]);

    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Revision History' });

    expect(result.entries).toHaveLength(0);
  });
});
