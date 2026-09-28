/**
 * Which language a learn.jamf.com article is served in, and what
 * `jamf_docs_get_article` and `jamf_docs_batch_get_articles` say about it.
 *
 * Live on 2026-09-28, the en-US Policies.html asked for in ja-JP came back as
 * ポリシー from `/r/ja-JP/jamf-pro-documentation-current/Policies`, and in
 * th-TH or zh-CN, which Jamf Pro Documentation is not published in, as the
 * en-US Policies. All three ended with the same note: `Language "…" was
 * requested but this article was resolved from a "en-US" URL. Content may be
 * in the original language if a localized version is unavailable.` So the
 * note read the same whether the language asked for was served or not, and
 * `contentLocale`, the field that says which language the content is in, was
 * absent on every channel: only an `ArticleProvider` and, since #378, a
 * concepts.jamf.com or support.jamf.com page set it. A batch's results had no
 * such field at all. And a th-TH url with no `language` came back as the en-US
 * Policies with no note, under the th-TH url.
 *
 * Now `contentLocale` is the topic's own `ft:locale`, which 22 of 22 topics
 * sampled across one map in each of Jamf's 11 locales carried, equal to their
 * map's (2026-09-28). The note says which happened, in the words
 * `jamf_docs_get_toc`'s `localeNote` and a static page's note use, and a
 * topic in another language than its url's is labelled with its own address.
 * A provider's `contentLocale` counts only when it is one of the tool's
 * locale ids.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver,
 * so the fallback to the en-US map is the registry's own, and only the http
 * client stubbed.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants/locales.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import type { FetchArticleResult, FtMapInfo, FtTocNode, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures: Jamf Pro Documentation 11.32.0, en-US and ja-JP (2026-09-24) ──

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRO_MAP_JA = 'GE9~jUeMhje7axrw1dW5VA';
const POLICIES = '0Kv7TU1RQ7Sd8J2yMYv8Ew';
const POLICIES_JA = '5j4iXKsKVvDiCZ055Zr_xA';

const policiesUrl = (locale: string): string =>
  `https://learn.jamf.com/${locale}/bundle/jamf-pro-documentation/page/Policies.html`;
const POLICIES_URL = policiesUrl('en-US');
const POLICIES_OWN = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies';
const POLICIES_JA_OWN = 'https://learn.jamf.com/r/ja-JP/jamf-pro-documentation-current/Policies';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

function proMap(id: string, locale: string, title: string): FtMapInfo {
  return {
    id,
    title,
    mapApiEndpoint: `/api/khub/maps/${id}`,
    metadata: [
      meta('version_bundle_stem', 'jamf-pro-documentation'),
      meta('version', '11.32.0'),
      meta('bundle', 'jamf-pro-documentation-current', 'jamf-pro-documentation-11.32.0'),
      meta('latestVersion', 'yes'),
      meta('ft:locale', locale),
      meta('jamf:portal', 'Jamf Pro'),
    ],
  };
}

/** The locales the fixture's maps publish Jamf Pro Documentation in. */
const PUBLISHED = [
  [PRO_MAP, 'en-US', 'Jamf Pro Documentation 11.32.0'],
  [PRO_MAP_JA, 'ja-JP', 'Jamf Pro ドキュメント 11.32.0'],
] as const;
const MAPS = PUBLISHED.map(([id, locale, title]) => proMap(id, locale, title));

/** Every other `language`: it has no map of its own, and falls back to en-US. */
const UNPUBLISHED = SUPPORTED_LOCALE_IDS.filter(id => !PUBLISHED.some(([, locale]) => locale === id));

/** A topic as the live single-topic endpoint, and the map's topic listing, send it, trimmed. */
function topicInfo(mapId: string, id: string, title: string, locale: string): FtTopicInfo {
  return {
    title,
    id,
    contentApiEndpoint: `/api/khub/maps/${mapId}/topics/${id}/content`,
    metadata: [
      meta('version', '11.32.0'),
      meta('version_bundle_stem', 'jamf-pro-documentation'),
      meta('legacy_topicname', 'Policies'),
      meta('ft:lastEdition', '2025-07-31'),
      meta('ft:locale', locale),
      meta('ft:prettyUrl', `${locale}/jamf-pro-documentation-current/Policies`),
    ],
  };
}

/** Each map's one topic, Policies, by map id. */
const TOPICS: Record<string, FtTopicInfo> = {
  [PRO_MAP]: topicInfo(PRO_MAP, POLICIES, 'Policies', 'en-US'),
  [PRO_MAP_JA]: topicInfo(PRO_MAP_JA, POLICIES_JA, 'ポリシー', 'ja-JP'),
};

/** `topic` with its `key` metadata left out, or, given `values`, holding those. */
function withMeta(topic: FtTopicInfo, key: string, ...values: string[]): FtTopicInfo {
  const kept = (topic.metadata ?? []).filter(entry => entry.key !== key);
  return { ...topic, metadata: values.length > 0 ? [...kept, meta(key, ...values)] : kept };
}

const BODIES: Record<string, string> = {
  [POLICIES]: '<div class="body conbody"><p class="p">Policies allow you to remotely automate common management tasks.</p></div>',
  [POLICIES_JA]: '<div class="body conbody"><p class="p">ポリシーを使用すると、一般的な管理タスクをリモートで自動化できます。</p></div>',
};

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * The fixtures served offline, with `topics` over the maps' topics, and each
 * map's TOC from `tocs`, empty for a map it leaves out.
 */
function upstream(topics: Record<string, FtTopicInfo> = TOPICS, tocs: Record<string, FtTocNode[]> = {}): ServerContext {
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      await Promise.resolve();
      if (url === MAPS_LIST) { return MAPS as T; }
      const path = decodeURIComponent(new URL(url).pathname);
      const match = /^\/api\/khub\/maps\/([^/]+)(\/.*)?$/.exec(path);
      if (match !== null && Object.hasOwn(topics, match[1])) {
        const topic = topics[match[1]];
        const rest = match[2];
        if (rest === '/toc') { return (tocs[match[1]] ?? []) as T; }
        if (rest === '/topics') { return [topic] as T; }
        if (rest === `/topics/${topic.id}`) { return topic as T; }
      }
      throw new Error(`offline: no fixture for ${url}`);
    },
    getText: async (url) => {
      await Promise.resolve();
      const id = /\/topics\/([^/]+)\/content$/.exec(decodeURIComponent(new URL(url).pathname))?.[1];
      if (id !== undefined && Object.hasOwn(BODIES, id)) { return BODIES[id]; }
      throw new Error(`offline: no fixture for ${url}`);
    },
    postJson: async (url) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return createMockContext({ cache, http, mapsRegistry, topicResolver });
}

interface Reply { isError?: boolean; text: string; structured: Record<string, unknown> }

async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listing first is what makes the client validate structuredContent
    // against each tool's outputSchema.
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    return {
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
      text: (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n'),
      structured: (result.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** One get_article call's article, as each channel gives it. */
interface Served {
  title: unknown;
  url: unknown;
  /** From `structuredContent`, then the JSON text, which must agree. */
  contentLocale: unknown;
  /** The note the markdown reply ends with, or undefined for none. */
  note: string | undefined;
}

const NOTE = /\n\n---\n\*Note: ([^\n]*)\*\n/;

async function served(args: Record<string, unknown>): Promise<Served> {
  const ctx = upstream();
  const markdown = await call(ctx, 'jamf_docs_get_article', args);
  const compact = await call(ctx, 'jamf_docs_get_article', { ...args, outputMode: 'compact' });
  const json = await call(ctx, 'jamf_docs_get_article', { ...args, responseFormat: 'json' });
  for (const reply of [markdown, compact, json]) {
    expect(reply.isError).toBeUndefined();
  }
  const text = JSON.parse(json.text) as { contentLocale?: unknown; content: string };
  // Every channel says the same: the JSON text, both structured channels.
  expect(text.contentLocale).toBe(markdown.structured.contentLocale);
  expect(json.structured.contentLocale).toBe(markdown.structured.contentLocale);
  expect(compact.structured.contentLocale).toBe(markdown.structured.contentLocale);
  const note = NOTE.exec(markdown.text)?.[1];
  expect(NOTE.exec(text.content)?.[1]).toBe(note);
  return {
    title: markdown.structured.title,
    url: markdown.structured.url,
    contentLocale: markdown.structured.contentLocale,
    note,
  };
}

const notPublished = (asked: string, shown: string): string =>
  `Jamf does not publish this article in ${asked}. Showing the ${shown} edition instead.`;

const shownAsAsked = (shown: string, urlLocale: string, ownAddress = true): string =>
  `Showing the ${shown} edition of this article, as \`language\` asked${ownAddress ? ', under its own address' : ''}:`
  + ` the url passed is in ${urlLocale}.`;

const unknownLanguage = (requested: string, urlLocale: string): string =>
  `Language "${requested}" was requested for a url in ${urlLocale}, and this article does not say which language it is in.`;

// ── get_article ─────────────────────────────────────────────────────────────

describe('jamf_docs_get_article: which language a learn.jamf.com article is served in', () => {
  it('serves the ja-JP edition of an en-US url asked for in ja-JP, and says it did', async () => {
    const article = await served({ url: POLICIES_URL, language: 'ja-JP' });

    expect(article).toEqual({
      title: 'ポリシー',
      url: POLICIES_JA_OWN,
      contentLocale: 'ja-JP',
      note: shownAsAsked('ja-JP', 'en-US'),
    });
  });

  it('serves the en-US edition of a ja-JP url asked for in en-US, and says it did', async () => {
    const article = await served({ url: policiesUrl('ja-JP'), language: 'en-US' });

    expect(article).toEqual({
      title: 'Policies', url: POLICIES_OWN, contentLocale: 'en-US', note: shownAsAsked('en-US', 'ja-JP'),
    });
  });

  it.each(UNPUBLISHED)('serves the en-US edition asked for in %s, which Jamf does not publish it in, and says so', async (language) => {
    const article = await served({ url: POLICIES_URL, language });

    expect(article).toEqual({
      title: 'Policies', url: POLICIES_OWN, contentLocale: 'en-US', note: notPublished(language, 'en-US'),
    });
  });

  it.each(UNPUBLISHED)('says so for a %s url too, with no `language`: the url\'s is the one asked for', async (language) => {
    const article = await served({ url: policiesUrl(language) });

    // Under the topic's own address, not the url's: until 2026-09-28 it was
    // the url passed, which names a page in a language the topic is not in.
    expect(article).toEqual({
      title: 'Policies', url: POLICIES_OWN, contentLocale: 'en-US', note: notPublished(language, 'en-US'),
    });
  });

  it('labels the en-US topic an en-GB url is answered with by its own address too, and says why', async () => {
    // en-GB is no locale of this server's, and resolved as en-US; its label
    // was the topic's own address before 2026-09-28 as well.
    const article = await served({ url: policiesUrl('en-GB') });

    expect(article).toEqual({
      title: 'Policies', url: POLICIES_OWN, contentLocale: 'en-US', note: notPublished('en-GB', 'en-US'),
    });
  });

  it.each([
    ['an en-US url', { url: POLICIES_URL }, 'Policies', 'en-US'],
    ['an en-US url in en-US', { url: POLICIES_URL, language: 'en-US' }, 'Policies', 'en-US'],
    ['a ja-JP url', { url: policiesUrl('ja-JP') }, 'ポリシー', 'ja-JP'],
    ['a ja-JP url in ja-JP', { url: policiesUrl('ja-JP'), language: 'ja-JP' }, 'ポリシー', 'ja-JP'],
    ['the en-US pair', { mapId: PRO_MAP, contentId: POLICIES }, 'Policies', 'en-US'],
    ['the ja-JP pair', { mapId: PRO_MAP_JA, contentId: POLICIES_JA }, 'ポリシー', 'ja-JP'],
  ])('names the language of %s, with no note', async (_name, args, title, locale) => {
    const article = await served(args);

    expect(article.title).toBe(title);
    expect(article.contentLocale).toBe(locale);
    expect(article.note).toBeUndefined();
  });

  it('names the pair\'s map\'s language beside a `language` the pair does not take', async () => {
    const article = await served({ mapId: PRO_MAP_JA, contentId: POLICIES_JA, language: 'en-US' });

    expect(article.contentLocale).toBe('ja-JP');
    expect(article.note).toBe('Language "en-US" was requested, but `language` has no effect on a mapId'
      + ' + contentId pair: this article comes from the pair\'s map, which is "ja-JP".');
  });

  it('never ends with the note that did not say which language was served', async () => {
    for (const language of ['ja-JP', ...UNPUBLISHED]) {
      const { note } = await served({ url: POLICIES_URL, language });
      expect(note).not.toContain('Content may be in the original language');
    }
  });

  it('reads the language of an article an earlier build cached, which holds no contentLocale, off its own address', async () => {
    // As a build before 2026-09-28 wrote it: no `contentLocale`.
    const ctx = upstream();
    await ctx.cache.set(cacheKey('ft-article-v3', { mapId: PRO_MAP_JA, contentId: POLICIES_JA, articleUrl: POLICIES_URL }), {
      title: 'ポリシー',
      parsed: { title: 'ポリシー', content: 'ポリシー本文。', breadcrumb: [], relatedArticles: [] },
      displayUrl: POLICIES_URL,
      product: 'Jamf Pro',
      version: '11.32.0',
      lastUpdated: '2025-07-31',
      ownUrl: POLICIES_JA_OWN,
    });

    const reply = await call(ctx, 'jamf_docs_get_article', { url: POLICIES_URL, language: 'ja-JP' });

    expect(reply.structured.content).toContain('ポリシー本文。');
    expect(reply.structured.contentLocale).toBe('ja-JP');
    expect(NOTE.exec(reply.text)?.[1]).toBe(shownAsAsked('ja-JP', 'en-US'));
  });

  it('reads the language of an article an earlier build cached with no address either off its place in the TOC', async () => {
    // As a build before `ownUrl` was cached wrote it: labelled from the TOC.
    const ctx = upstream(TOPICS, {
      [PRO_MAP_JA]: [{ tocId: 'ja-policies', contentId: POLICIES_JA, title: 'ポリシー', prettyUrl: '/r/ja-JP/jamf-pro-documentation-current/Policies' }],
    });
    await ctx.cache.set(cacheKey('ft-article-v3', { mapId: PRO_MAP_JA, contentId: POLICIES_JA, articleUrl: POLICIES_URL }), {
      title: 'ポリシー',
      parsed: { title: 'ポリシー', content: 'ポリシー本文。', breadcrumb: [], relatedArticles: [] },
      displayUrl: POLICIES_URL,
      product: 'Jamf Pro',
      version: '11.32.0',
    });

    const reply = await call(ctx, 'jamf_docs_get_article', { url: POLICIES_URL, language: 'ja-JP' });

    expect(reply.structured.content).toContain('ポリシー本文。');
    expect(reply.structured.url).toBe(POLICIES_JA_OWN);
    expect(reply.structured.contentLocale).toBe('ja-JP');
    expect(NOTE.exec(reply.text)?.[1]).toBe(shownAsAsked('ja-JP', 'en-US'));
  });

  it('reads the language off the topic\'s `ft:locale`, not its address', async () => {
    // A topic with no address of its own, which no sampled topic is: only
    // `ft:locale` says it is in ja-JP. It is labelled with the url passed, so
    // the note does not say it is under its own address.
    const unaddressed = withMeta(TOPICS[PRO_MAP_JA], 'ft:prettyUrl');

    const reply = await call(upstream({ ...TOPICS, [PRO_MAP_JA]: unaddressed }), 'jamf_docs_get_article', {
      url: POLICIES_URL, language: 'ja-JP',
    });

    expect(reply.structured.title).toBe('ポリシー');
    expect(reply.structured.url).toBe(POLICIES_URL);
    expect(reply.structured.contentLocale).toBe('ja-JP');
    expect(NOTE.exec(reply.text)?.[1]).toBe(shownAsAsked('ja-JP', 'en-US', false));
  });

  it('names the map\'s language in the pair note from `ft:locale` when the topic has no address', async () => {
    const unaddressed = withMeta(TOPICS[PRO_MAP_JA], 'ft:prettyUrl');

    const reply = await call(upstream({ ...TOPICS, [PRO_MAP_JA]: unaddressed }), 'jamf_docs_get_article', {
      mapId: PRO_MAP_JA, contentId: POLICIES_JA, language: 'en-US',
    });

    expect(reply.structured.contentLocale).toBe('ja-JP');
    expect(NOTE.exec(reply.text)?.[1]).toBe('Language "en-US" was requested, but `language` has no effect on a mapId'
      + ' + contentId pair: this article comes from the pair\'s map, which is "ja-JP".');
  });

  it.each([
    ['empty', ['']],
    ['absent', []],
    ['not a locale id of this server\'s', ['ja']],
  ])('reads the language off the topic\'s address when its `ft:locale` is %s', async (_name, values) => {
    const topic = withMeta(TOPICS[PRO_MAP_JA], 'ft:locale', ...values);

    const reply = await call(upstream({ ...TOPICS, [PRO_MAP_JA]: topic }), 'jamf_docs_get_article', {
      url: POLICIES_URL, language: 'ja-JP',
    });

    expect(reply.structured.contentLocale).toBe('ja-JP');
    expect(NOTE.exec(reply.text)?.[1]).toBe(shownAsAsked('ja-JP', 'en-US'));
  });
});

// ── With an ArticleProvider ─────────────────────────────────────────────────

/** A page as a provider holds it, labelled `url`, saying `contentLocale` when given. */
function providerPage(url: string, contentLocale?: string): FetchArticleResult {
  const content = 'A page a provider holds.';
  return {
    title: 'Policies', url, content, sections: [],
    ...(contentLocale !== undefined ? { contentLocale } : {}),
    tokenInfo: { tokenCount: estimateTokens(content), truncated: false, maxTokens: 5000 },
  };
}

describe('jamf_docs_get_article: the language of a provider\'s article', () => {
  async function noteFor(page: FetchArticleResult, args: Record<string, unknown>): Promise<string | undefined> {
    const ctx = upstream();
    ctx.articleProvider = { getArticleByIds: async () => await Promise.resolve(page) };
    const reply = await call(ctx, 'jamf_docs_get_article', args);
    expect(reply.isError).toBeUndefined();
    return NOTE.exec(reply.text)?.[1];
  }

  it.each([
    // '' used to make it "Showing the  edition instead.", and `en` or `ja`
    // "does not publish this article in …", `ja` of a Japanese page.
    ['\'\'', '', 'th-TH'],
    ['en', 'en', 'th-TH'],
    ['ja', 'ja', 'ja-JP'],
    // A key every object has, but no locale id.
    ['constructor', 'constructor', 'th-TH'],
  ])('counts a `contentLocale` of %s as saying nothing', async (_name, contentLocale, language) => {
    expect(await noteFor(providerPage(POLICIES_URL, contentLocale), { url: POLICIES_URL, language }))
      .toBe(unknownLanguage(language, 'en-US'));
  });

  it('reads the language off the page\'s own address when its `contentLocale` says nothing', async () => {
    expect(await noteFor(providerPage(POLICIES_JA_OWN, 'ja'), { url: POLICIES_URL, language: 'ja-JP' }))
      .toBe(shownAsAsked('ja-JP', 'en-US'));
  });

  it('reads no language off an own address in a locale this server does not have', async () => {
    const enGb = providerPage(policiesUrl('en-GB'));

    expect(await noteFor(enGb, { url: POLICIES_URL, language: 'en-US' })).toBeUndefined();
    expect(await noteFor(enGb, { url: POLICIES_URL, language: 'th-TH' })).toBe(unknownLanguage('th-TH', 'en-US'));
  });

  it('names a locale id it gives, and says the page is under the url passed when it is', async () => {
    expect(await noteFor(providerPage(POLICIES_URL, 'ja-JP'), { url: POLICIES_URL, language: 'ja-JP' }))
      .toBe(shownAsAsked('ja-JP', 'en-US', false));
    expect(await noteFor(providerPage(POLICIES_URL, 'en-US'), { url: POLICIES_URL, language: 'th-TH' }))
      .toBe(notPublished('th-TH', 'en-US'));
  });

  it.each([
    ['in the url\'s own language', { url: POLICIES_URL, language: 'en-US' }],
    ['with no `language`', { url: POLICIES_URL }],
  ])('says nothing of a page that gives no language, asked for %s', async (_name, args) => {
    expect(await noteFor(providerPage(POLICIES_URL), args)).toBeUndefined();
  });
});

// ── batch_get_articles ──────────────────────────────────────────────────────

interface BatchResult { status: string; title?: string; contentLocale?: unknown; content?: string }

describe('jamf_docs_batch_get_articles: which language each learn.jamf.com article is served in', () => {
  it.each([
    ['ja-JP', 'ポリシー', 'ja-JP', shownAsAsked('ja-JP', 'en-US')],
    ...UNPUBLISHED.map(language => [language, 'Policies', 'en-US', notPublished(language, 'en-US')]),
  ])('names it per result in %s, in the JSON text and structuredContent, with the note', async (language, title, locale, note) => {
    const ctx = upstream();
    const args = { urls: [POLICIES_URL, policiesUrl('ja-JP')], language, maxTokens: 2000 };

    const json = await call(ctx, 'jamf_docs_batch_get_articles', { ...args, responseFormat: 'json' });
    const markdown = await call(ctx, 'jamf_docs_batch_get_articles', args);

    const text = (JSON.parse(json.text) as { results: BatchResult[] }).results;
    const structured = json.structured.results as BatchResult[];
    for (const results of [text, structured, markdown.structured.results as BatchResult[]]) {
      expect(results.map(result => [result.status, result.title, result.contentLocale]))
        .toEqual([['success', title, locale], ['success', title, locale]]);
    }
    expect(NOTE.exec(text[0].content ?? '')?.[1]).toBe(note);
    expect(markdown.text).toContain(`*Note: ${note}*`);
  });

  it('names the language of each result asked for with no `language`, and a failed one has none', async () => {
    const ctx = upstream();

    const json = await call(ctx, 'jamf_docs_batch_get_articles', {
      urls: [POLICIES_URL, policiesUrl('ja-JP'), 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Nope.html'],
      responseFormat: 'json',
    });

    const results = json.structured.results as BatchResult[];
    expect(results.map(result => [result.status, result.contentLocale]))
      .toEqual([['success', 'en-US'], ['success', 'ja-JP'], ['error', undefined]]);
    expect((JSON.parse(json.text) as { results: BatchResult[] }).results.map(result => result.contentLocale))
      .toEqual(['en-US', 'ja-JP', undefined]);
  });
});
