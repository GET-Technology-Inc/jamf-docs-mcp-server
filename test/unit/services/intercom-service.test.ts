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

  it('keeps an image that sits inline in a paragraph', () => {
    // `inlineText` strips every tag it does not convert, so an inline image
    // was dropped without trace. 212 of the 221 live cases were the whole
    // paragraph, which therefore rendered to nothing at all.
    const out = renderBlock({
      type: 'paragraph',
      text: '<img src="https://downloads.intercomcdn.com/i/o/x.png" width="24" alt="Supervision">',
    });
    expect(out).toContain('![Supervision](https://downloads.intercomcdn.com/i/o/x.png)');
  });

  it('keeps both halves of a paragraph mixing text and an image', () => {
    const out = renderBlock({
      type: 'paragraph',
      text: 'Look for <img src="https://x/y.png" alt="the icon"> in the list.',
    });
    expect(out).toContain('Look for ![the icon](https://x/y.png) in the list.');
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

  // ─── types that used to be dropped ────────────────────────────
  //
  // Each fixture below is the shape of a real live block, not a convenient
  // one. All four were unhandled until 2026-09-14, and every one of them
  // failed silently: three rendered nothing at all and the fourth rendered
  // "[object Object]" where a section title belonged.

  it('renders a table, which used to vanish whole', () => {
    // From "MFA compatibility with Platform SSO and Microsoft Entra ID".
    // A cell holds a block array, and the header row is marked by nothing
    // but a background colour — which is why the first row is the header
    // by position rather than by inspection.
    const out = renderBlock({
      type: 'table',
      stacked: true,
      rows: [
        { cells: [
          { style: { backgroundColor: '#e3e7fa80' }, content: [{ type: 'paragraph', text: '<b>Feature</b>' }] },
          { style: { backgroundColor: '#e3e7fa80' }, content: [{ type: 'paragraph', text: '<b>Conditional Access MFA</b>' }] },
        ] },
        { cells: [
          { content: [{ type: 'paragraph', text: 'PSSO / Microsoft Auth Broker' }] },
          { content: [{ type: 'paragraph', text: '✅ Compatible' }] },
        ] },
      ],
    });
    expect(out).toContain('| **Feature** | **Conditional Access MFA** |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| PSSO / Microsoft Auth Broker | ✅ Compatible |');
  });

  it('flattens block content inside a cell onto its row', () => {
    // 254 of the 1,118 live cells carry more than one block and 45 carry a
    // list. Markdown has nowhere to put that, so the words survive and the
    // bullets do not — the alternative is a row break that ends the table.
    const out = renderBlock({
      type: 'table',
      rows: [
        { cells: [{ content: [{ type: 'paragraph', text: 'Step' }] }] },
        { cells: [{ content: [
          { type: 'paragraph', text: 'Do this:' },
          { type: 'unorderedNestedList', items: [
            { content: [{ type: 'paragraph', text: 'First' }] },
            { content: [{ type: 'paragraph', text: 'Second' }] },
          ] },
        ] }] },
      ],
    });
    expect(out).toContain('| Do this: - First - Second |');
    expect(out.split('\n').filter(line => line.startsWith('|'))).toHaveLength(3);
  });

  it('escapes a pipe so one cell cannot silently become two', () => {
    const out = renderBlock({
      type: 'table',
      rows: [
        { cells: [{ content: [{ type: 'paragraph', text: 'Pattern' }] }] },
        { cells: [{ content: [{ type: 'paragraph', text: 'a | b' }] }] },
      ],
    });
    expect(out).toContain('| a \\| b |');
  });

  it('escapes a backslash so it cannot defeat the pipe escape', () => {
    // Escaping only the pipe turns `a\|b` into `a\\|b`, which renders as a
    // literal backslash followed by a column break — one cell silently
    // becoming two, by way of the character the escape is made of.
    const out = renderBlock({
      type: 'table',
      rows: [
        { cells: [{ content: [{ type: 'paragraph', text: 'Pattern' }] }] },
        { cells: [{ content: [{ type: 'paragraph', text: 'a\\|b' }] }] },
      ],
    });
    expect(out).toContain('| a\\\\\\|b |');
  });

  it('pads a ragged row rather than emitting a table renderers disagree on', () => {
    const out = renderBlock({
      type: 'table',
      rows: [
        { cells: [
          { content: [{ type: 'paragraph', text: 'A' }] },
          { content: [{ type: 'paragraph', text: 'B' }] },
        ] },
        { cells: [{ content: [{ type: 'paragraph', text: 'only one' }] }] },
      ],
    });
    expect(out).toContain('| only one |  |');
  });

  it('renders subheading3 as a heading, not as body text', () => {
    // It has `text`, so the unknown-type fallback used to render it as an
    // ordinary paragraph: the words survived and the document structure did
    // not, which is the harder failure to notice.
    expect(renderBlock({ type: 'subheading3', text: 'Upload Options' }))
      .toBe('#### Upload Options\n\n');
  });

  it('renders a video, which carries neither text nor url', () => {
    expect(renderBlock({ type: 'video', provider: 'youtube', id: 'jpLJB4RGsSU' }))
      .toBe('[Video](https://www.youtube.com/watch?v=jpLJB4RGsSU)\n\n');
  });

  it('keeps the identifiers of a video from a provider it cannot link', () => {
    const out = renderBlock({ type: 'video', provider: 'vimeo', id: '12345' });
    expect(out).toContain('vimeo');
    expect(out).toContain('12345');
  });

  it('reads a collapsible summary sent as a block rather than a string', () => {
    // All 42 live sections send it this way. The string form this file's own
    // interface declared occurs nowhere, and interpolating the object put
    // "**[object Object]**" where the section title belonged in 18 articles.
    const out = renderBlock({
      type: 'collapsibleSection',
      summary: { type: 'subheading3', text: 'What is the difference between Messages and Tickets?' },
      content: [{ type: 'paragraph', text: 'Hidden body.' }],
    });
    expect(out).toContain('**What is the difference between Messages and Tickets?**');
    expect(out).not.toContain('[object Object]');
  });

  // ─── code blocks arrive as HTML ───────────────────────────────

  it('turns the HTML in a code block into code a reader can run', () => {
    // Live text from "Grant Secure Token to enable FileVault". Copied
    // verbatim into a fence, this was one line with a literal <br> in it —
    // and a code sample is the part of a page a reader means to copy.
    const out = renderBlock({
      type: 'code',
      text: 'fdesetup list -extended<br>sysadminctl -secureTokenStatus username_goes_here',
    });
    expect(out).toContain('```\nfdesetup list -extended\nsysadminctl -secureTokenStatus username_goes_here\n```');
  });

  it('decodes the entities a plist sample arrives with', () => {
    expect(renderBlock({ type: 'code', text: '&lt;key&gt;PayloadType&lt;/key&gt;' }))
      .toContain('<key>PayloadType</key>');
  });

  it('does not give a line break to a sample documenting the text "<br>"', () => {
    // Order is the whole point: <br> becomes a newline before entities are
    // decoded, so an escaped one stays literal.
    const out = renderBlock({ type: 'code', text: 'echo "&lt;br&gt;"' });
    expect(out).toContain('echo "<br>"');
    expect(out.split('\n').filter(line => line !== '' && !line.startsWith('```'))).toHaveLength(1);
  });

  it('carries the language hint upstream sends on one block in 149', () => {
    expect(renderBlock({ type: 'code', language: 'bash', text: 'sudo profiles show' }))
      .toContain('```bash\n');
  });

  it('lengthens the fence rather than letting content break out of it', () => {
    // No live sample does this. One that did would not just break its own
    // block, it would leave the rest of the article inside a code fence.
    expect(renderBlock({ type: 'code', text: 'echo ```' }))
      .toContain('````\necho ```\n````');
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

  it('requests the collection page in the spelling the source serves', async () => {
    // Intercom lists every collection slashless today (0 of 86, 2026-09-26),
    // but support.jamf.com 301s the slashed form, so a collection listed with
    // the slash would cost a round trip per TOC if requested as listed (#338).
    mockHttpGetText.mockResolvedValue(page({ collection: { articleSummaries: [], subcollections: [] } }));

    await fetchIntercomCollectionToc(createMockContext(), SUPPORT, { ...COLLECTION, url: `${COLLECTION.url}/` });

    expect(mockHttpGetText.mock.calls).toEqual([[COLLECTION.url]]);
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
