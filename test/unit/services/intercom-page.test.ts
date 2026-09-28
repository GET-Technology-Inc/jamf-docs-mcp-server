/**
 * `parseIntercomPage`: an Intercom Help Center page as `jamf_docs_get_article`
 * reads it, an article or a collection, with the editions the page lists.
 *
 * The shapes are support.jamf.com's, measured 2026-09-28: `localeLinks` is
 * one entry per locale, `available` where the page has an edition there and
 * `selected` on the one it is; a collection page carries `collection` with
 * its `articleSummaries` and `subcollections`, one level deep on all 9 of the
 * site's collections. The payload comes off the wire, so a field of another
 * type is read as absent rather than failing the page.
 */

import { describe, it, expect } from 'vitest';
import { parseIntercomPage } from '../../../src/core/services/intercom-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { nextDataPage } from '../../helpers/support-upstream.js';

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const ORIGIN = SUPPORT.baseUrl;

const LOCALE_LINKS = [
  { id: 'en', absoluteUrl: `${ORIGIN}/en/articles/1-first`, available: true, selected: true },
  { id: 'ja', absoluteUrl: `${ORIGIN}/ja/articles/1-最初`, available: true, selected: false },
  { id: 'fr', absoluteUrl: `${ORIGIN}/fr/articles/1`, available: false, selected: false },
];

describe('parseIntercomPage: editions', () => {
  it('reads which edition a page is, and where each other one is', () => {
    const article = parseIntercomPage(nextDataPage({
      articleContent: { title: 'First', blocks: [] },
      localeLinks: LOCALE_LINKS,
    }), SUPPORT);

    expect(article?.editions).toEqual({
      locale: 'en',
      url: `${ORIGIN}/en/articles/1-first`,
      editions: { en: `${ORIGIN}/en/articles/1-first`, ja: `${ORIGIN}/ja/articles/1-最初`, fr: null },
    });
  });

  it.each([
    ['no localeLinks', {}],
    ['localeLinks that is not a list', { localeLinks: { en: true } }],
    ['no selected edition', { localeLinks: LOCALE_LINKS.map(link => ({ ...link, selected: false })) }],
    ['a selected edition with no address', { localeLinks: [{ ...LOCALE_LINKS[0], absoluteUrl: '' }] }],
    ['entries of the wrong types', { localeLinks: [{ id: 1, absoluteUrl: null, selected: 'yes' }, null] }],
  ])('reads a page with %s as listing no editions, and still reads the page', (_label, props) => {
    const article = parseIntercomPage(nextDataPage({ articleContent: { title: 'First', blocks: [] }, ...props }), SUPPORT);

    expect(article?.title).toBe('First');
    expect(article?.editions).toBeUndefined();
  });
});

describe('parseIntercomPage: a collection', () => {
  it('lists its articles, then each subcollection under a heading one level down', () => {
    const article = parseIntercomPage(nextDataPage({
      collection: {
        name: 'Jamf Pro',
        description: 'Articles for managing devices using Jamf Pro.',
        articleSummaries: [{ title: 'Own [article]', url: `${ORIGIN}/en/articles/1-own-article/` }],
        subcollections: [{
          name: 'Self Service+',
          description: 'An end user application.',
          articleSummaries: [{ title: 'Filed', url: `${ORIGIN}/en/articles/2-filed` }],
          // A name's line breaks and runs of spaces are one space, so its heading is one line.
          subcollections: [{ name: ' Deeper\n  still ', articleSummaries: [{ title: 'Deep', url: `${ORIGIN}/en/articles/3-deep` }] }],
        }],
      },
      breadcrumbs: [],
    }), SUPPORT);

    expect(article?.title).toBe('Jamf Pro');
    expect(article?.kind).toBe('collection');
    expect(article?.content).toBe([
      'Articles for managing devices using Jamf Pro.',
      // The title escaped and the url in the source's spelling, as the TOC gives them.
      `- [Own \\[article\\]](${ORIGIN}/en/articles/1-own-article)`,
      '## Self Service+',
      'An end user application.',
      `- [Filed](${ORIGIN}/en/articles/2-filed)`,
      '### Deeper still',
      `- [Deep](${ORIGIN}/en/articles/3-deep)`,
    ].join('\n\n'));
  });

  it('says so of a collection with no articles', () => {
    const article = parseIntercomPage(nextDataPage({ collection: { name: 'Empty' } }), SUPPORT);

    expect(article?.content).toBe('This collection lists no articles.');
  });

  it('reads lists of the wrong type as empty, and skips what in a list is not an object', () => {
    const odd = parseIntercomPage(nextDataPage({
      collection: { name: 'Odd', articleSummaries: 'none', subcollections: { a: 1 } },
    }), SUPPORT);
    const holes = parseIntercomPage(nextDataPage({
      collection: {
        name: 'Holes',
        articleSummaries: [null, 'x', { title: 'Kept', url: `${ORIGIN}/en/articles/4-kept` }],
        subcollections: [null, 7],
      },
    }), SUPPORT);

    expect(odd?.content).toBe('This collection lists no articles.');
    expect(holes?.content).toBe(`- [Kept](${ORIGIN}/en/articles/4-kept)`);
  });

  it('reads an article with something to show before a collection, and neither from a page with neither', () => {
    const both = parseIntercomPage(nextDataPage({
      articleContent: { title: 'Article', blocks: [{ type: 'paragraph', text: 'Body.' }] },
      collection: { name: 'Collection', articleSummaries: [{ title: 'Filed', url: `${ORIGIN}/en/articles/2-filed` }] },
    }), SUPPORT);
    expect(both?.title).toBe('Article');
    expect(both?.kind).toBe('article');
    expect(both?.content).toBe('Body.');
    // The tree is read all the same, as `jamf_docs_get_toc` always read it.
    expect(both?.toc).toEqual([{ title: 'Filed', url: `${ORIGIN}/en/articles/2-filed` }]);
    expect(parseIntercomPage(nextDataPage({ home: { collections: [] } }), SUPPORT)).toBeNull();
    expect(parseIntercomPage('<html><body>We will be back shortly.</body></html>', SUPPORT)).toBeNull();
  });

  // Until 2026-09-28 the article was read first whatever it held, and such a
  // page was served as "Untitled", with nothing in it. No page read that day
  // carried both.
  it.each([
    ['{}', {}],
    ['no blocks', { title: 'Article', blocks: [] }],
    ['blocks that are not a list', { title: 'Article', blocks: { type: 'paragraph', text: 'Body.' } }],
    ['blocks that render to nothing', { title: 'Article', blocks: [{ type: 'paragraph', text: '' }] }],
  ])('reads a page carrying a collection, and an articleContent of %s, as the collection', (_label, articleContent) => {
    const page = parseIntercomPage(nextDataPage({
      articleContent,
      collection: { name: 'Collection', articleSummaries: [{ title: 'Filed', url: `${ORIGIN}/en/articles/2-filed` }] },
    }), SUPPORT);

    expect(page?.kind).toBe('collection');
    expect(page?.title).toBe('Collection');
    expect(page?.content).toBe(`- [Filed](${ORIGIN}/en/articles/2-filed)`);
  });
});

describe('parseIntercomPage: an article\'s blocks as they come off the wire', () => {
  const article = (blocks: unknown): ReturnType<typeof parseIntercomPage> =>
    parseIntercomPage(nextDataPage({ articleContent: { title: 'Article', blocks } }), SUPPORT);

  // Each of these failed `jamf_docs_get_article` until 2026-09-28. No live
  // page had any that day.
  it.each([
    ['an object', { type: 'paragraph', text: 'Body.' }],
    ['a string', 'Body.'],
  ])('reads blocks that are %s as none, where it failed with "blocks.map is not a function"', (_label, blocks) => {
    const page = article(blocks);

    expect(page?.kind).toBe('article');
    expect(page?.content).toBe('');
    expect(page?.unreadBlocks).toBe(1);
  });

  it('leaves out a block that is not an object, where a null failed with "(reading \'type\')"', () => {
    const page = article([null, 7, 'Body.', { type: 'paragraph', text: 'Kept.' }]);

    expect(page?.content).toBe('Kept.');
    expect(page?.unreadBlocks).toBe(3);
  });

  it('leaves out a list item that is not an object, where a null failed with "(reading \'content\')"', () => {
    const page = article([
      { type: 'orderedNestedList', items: [null, { content: [{ type: 'paragraph', text: 'First' }] }, 'x'] },
      { type: 'unorderedNestedList', items: { content: [] } },
      { type: 'orderedNestedList', items: [{ content: [null, { type: 'paragraph', text: 'Second' }] }] },
    ]);

    // The list whose items are not a list renders as an empty one.
    expect(page?.content.split(/\n+/)).toEqual(['1. First', '1. Second']);
    expect(page?.unreadBlocks).toBe(4);
  });

  it('reads a text that is not a string as none, and a number as its digits', () => {
    const page = article([
      { type: 'paragraph', text: { html: 'x' } },
      { type: 'code', text: 42 },
      { type: 'heading', text: ['Top'] },
      { type: 7, text: 'Typed as a number.' },
      { type: 'collapsibleSection', summary: 5, content: 'none' },
      { type: 'image', url: null },
    ]);

    expect(page?.content).toBe([
      '```\n42\n```',
      '## ',
      'Typed as a number.',
      '**5**',
    ].join('\n\n'));
    // The paragraph's text, the heading's, and the section's content.
    expect(page?.unreadBlocks).toBe(3);
  });

  it('keeps a table\'s columns where a cell cannot be read, and leaves out a row that is not an object', () => {
    const cell = (text: string): unknown => ({ content: [{ type: 'paragraph', text }] });
    const page = article([{
      type: 'table',
      rows: [
        { cells: [cell('A'), cell('B'), cell('C')] },
        null,
        { cells: [null, cell('b'), { content: 'x' }] },
        { cells: 'none' },
      ],
    }]);

    expect(page?.content).toBe('| A | B | C |\n| --- | --- | --- |\n|  | b |  |');
    expect(page?.unreadBlocks).toBe(4);
  });

  // A callout's `style` is an object on every live callout, and a table
  // carries its flags (2026-09-28). Neither is read, so neither is counted.
  it('counts nothing on a page it reads whole, fields it does not read included', () => {
    const page = article([
      { type: 'paragraph', text: 'Body.' },
      {
        type: 'callout',
        style: { backgroundColor: '#d7efdc80', borderColor: '#1bb15733' },
        content: [{ type: 'paragraph', text: 'Note.' }],
      },
      {
        type: 'table',
        container: false,
        responsive: false,
        stacked: true,
        rows: [{ cells: [{ content: [{ type: 'paragraph', text: 'A' }], style: { backgroundColor: '#eee' } }] }],
      },
    ]);

    expect(page?.content).toBe('Body.\n\n> Note.\n\n| A |\n| --- |');
    expect(page?.unreadBlocks).toBeUndefined();
  });
});
