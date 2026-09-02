/**
 * Unit tests for the Intercom Help Center reader.
 *
 * The fixtures mirror shapes measured on support.jamf.com rather than shapes
 * that would be convenient: the `nonce` on the data script, the null
 * `markdown` field, list items whose text lives under `content`, and
 * `breadcrumbs` as a sibling of `articleContent`. Each of those is a way to
 * read the payload and get nothing back without an error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import {
  parseNextData,
  renderBlock,
  renderBlocks,
  parseIntercomArticle,
  listIntercomCollections,
  fetchIntercomCollectionToc,
} from '../../../src/core/services/intercom-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

/** The real page carries a `nonce` on this tag; a naive regex misses it. */
function page(pageProps: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="abc123">${
    JSON.stringify({ props: { pageProps } })
  }</script></body></html>`;
}

describe('parseNextData', () => {
  it('finds the payload despite the nonce attribute', () => {
    expect(parseNextData(page({ hello: 'world' }))).toEqual({ props: { pageProps: { hello: 'world' } } });
  });

  it('returns null rather than throwing on a page without it', () => {
    expect(parseNextData('<html><body>nothing</body></html>')).toBeNull();
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseNextData('<script id="__NEXT_DATA__" nonce="x">{oops</script>')).toBeNull();
  });
});

describe('renderBlock', () => {
  it('renders headings and subheadings at distinct levels', () => {
    expect(renderBlock({ type: 'heading', text: 'Top' })).toBe('## Top\n\n');
    // `subheading` is absent from the integration notes' list of block types.
    // A renderer that only knew those would drop it without a trace.
    expect(renderBlock({ type: 'subheading', text: 'Under' })).toBe('### Under\n\n');
  });

  it('converts the inline HTML a paragraph carries', () => {
    const out = renderBlock({
      type: 'paragraph',
      text: 'See <a href="https://learn.jamf.com/x">the guide</a> and <b>note</b> this.',
    });
    expect(out).toContain('[the guide](https://learn.jamf.com/x)');
    expect(out).toContain('**note**');
  });

  it('reads list item text from content, not from the item text field', () => {
    // The block's own `text` is a pre-rendered string of the whole list and
    // each item's text sits under `content`. Reading `item.text` yields empty
    // bullets — every item has the field and it is undefined on all of them,
    // so nothing errors.
    const out = renderBlock({
      type: 'orderedNestedList',
      text: '1. First\n2. Second',
      items: [
        { content: [{ type: 'paragraph', text: 'First' }] },
        { content: [{ type: 'paragraph', text: 'Second' }] },
      ],
    });
    expect(out).toContain('1. First');
    expect(out).toContain('2. Second');
  });

  it('renders an unordered list with bullets', () => {
    const out = renderBlock({
      type: 'unorderedNestedList',
      items: [{ content: [{ type: 'paragraph', text: 'Alpha' }] }],
    });
    expect(out).toContain('- Alpha');
  });

  it('keeps a callout distinguishable from body text', () => {
    // Callouts nest under `content`, not `text`. Flattening one into an
    // ordinary paragraph turns "do not do this" into a suggestion.
    const out = renderBlock({
      type: 'callout',
      style: 'warning',
      content: [{ type: 'paragraph', text: 'Do not do this.' }],
    });
    expect(out).toContain('> Do not do this.');
  });

  it('renders a collapsible section with its summary as the label', () => {
    const out = renderBlock({
      type: 'collapsibleSection',
      summary: 'More detail',
      content: [{ type: 'paragraph', text: 'Hidden body.' }],
    });
    expect(out).toContain('**More detail**');
    expect(out).toContain('Hidden body.');
  });

  it('renders code and images', () => {
    expect(renderBlock({ type: 'code', text: 'sudo jamf policy' })).toContain('```\nsudo jamf policy\n```');
    expect(renderBlock({ type: 'image', url: 'https://x/y.png' })).toBe('![](https://x/y.png)\n\n');
  });

  it('keeps the text of a type it does not know', () => {
    // Intercom adds block types over time, and a dropped block leaves no
    // trace — a reader cannot tell it from a paragraph never written.
    expect(renderBlock({ type: 'somethingNew', text: 'Still readable' }))
      .toContain('Still readable');
  });
});

describe('parseIntercomArticle', () => {
  it('reads the body from blocks, not from the markdown field', () => {
    // `markdown` is present on every article and null on every one measured.
    const html = page({
      articleContent: {
        title: 'Get Started',
        markdown: null,
        blocks: [{ type: 'paragraph', text: 'Body text.' }],
        lastUpdatedDate: '2026-03-26T00:00:00Z',
      },
      breadcrumbs: [{ label: 'Jamf Now' }, { label: 'App Management' }],
    });

    const article = parseIntercomArticle(html);

    expect(article?.title).toBe('Get Started');
    expect(article?.content).toBe('Body text.');
    expect(article?.lastUpdated).toBe('2026-03-26');
    // breadcrumbs is a sibling of articleContent under pageProps, not a key
    // of it — the easy place to look and find nothing.
    expect(article?.breadcrumb).toEqual(['Jamf Now', 'App Management']);
  });

  it('returns null for a page that is not an article', () => {
    expect(parseIntercomArticle(page({ home: { collections: [] } }))).toBeNull();
  });
});

describe('listIntercomCollections', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('reads the home collections and derives a slug from the URL', async () => {
    mockHttpGetText.mockResolvedValue(page({
      home: {
        collections: [{
          id: '12369024',
          name: 'Jamf Pro',
          description: 'Articles for managing devices using Jamf Pro.',
          url: 'https://support.jamf.com/en/collections/12369024-jamf-pro',
        }],
      },
    }));

    const [collection] = await listIntercomCollections(createMockContext(), SUPPORT, 'en');

    // The numeric prefix is Intercom's id and changes if a collection is
    // recreated; the slug is what a reader recognises.
    expect(collection.slug).toBe('jamf-pro');
    expect(collection.name).toBe('Jamf Pro');
  });

  it('requests the locale it was given', async () => {
    mockHttpGetText.mockResolvedValue(page({ home: { collections: [] } }));
    await listIntercomCollections(createMockContext(), SUPPORT, 'zh-TW');
    expect(mockHttpGetText).toHaveBeenCalledWith('https://support.jamf.com/zh-TW/');
  });
});

describe('fetchIntercomCollectionToc', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  const COLLECTION = {
    id: '1', slug: 'jamf-pro', name: 'Jamf Pro', description: '',
    url: 'https://support.jamf.com/en/collections/1-jamf-pro', articleCount: 2,
  };

  it('keeps articles that sit directly in the collection alongside the subcollections', async () => {
    // Jamf Pro has 11 of these beside 24 subcollections; reading only
    // `subcollections` drops them.
    mockHttpGetText.mockResolvedValue(page({
      collection: {
        articleSummaries: [{ title: 'Loose article', url: 'https://support.jamf.com/en/articles/1-loose' }],
        subcollections: [{
          name: 'Self Service+',
          url: 'https://support.jamf.com/en/collections/2-self-service',
          articleSummaries: [{ title: 'Nested article', url: 'https://support.jamf.com/en/articles/2-nested' }],
        }],
      },
    }));

    const toc = await fetchIntercomCollectionToc(createMockContext(), SUPPORT, COLLECTION);

    expect(toc.map(e => e.title)).toEqual(['Loose article', 'Self Service+']);
    expect(toc[1].children?.map(e => e.title)).toEqual(['Nested article']);
  });

  it('fetches the collection page once', async () => {
    mockHttpGetText.mockResolvedValue(page({ collection: { articleSummaries: [], subcollections: [] } }));
    const ctx = createMockContext();

    await fetchIntercomCollectionToc(ctx, SUPPORT, COLLECTION);
    await fetchIntercomCollectionToc(ctx, SUPPORT, COLLECTION);

    expect(mockHttpGetText).toHaveBeenCalledTimes(1);
  });
});

describe('renderBlocks', () => {
  it('joins blocks in order', () => {
    expect(renderBlocks([
      { type: 'heading', text: 'A' },
      { type: 'paragraph', text: 'B' },
    ])).toBe('## A\n\nB\n\n');
  });
});
