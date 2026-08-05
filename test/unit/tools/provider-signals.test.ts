/**
 * Regression tests for provider signals reaching the client — issues #213/#215.
 *
 * Both are the same defect at two call sites: a producer emits a field and the
 * output layer drops it, silently, on the channel a program reads.
 *
 *   #213 `formatSearchResult` / `buildSearchStructuredContent` never emitted
 *        `breadcrumb`, though `SearchOutputSchema` declares it and
 *        `buildSearchResult` populates it from the Fluid Topics topic. Page
 *        slugs collide across this corpus — `Overview`, `Policies`,
 *        `Getting-Started` and `Release-History` each exist under several
 *        products — so it is the one field that tells ten same-titled hits
 *        apart.
 *
 *   #215 `buildArticleStructuredContent` was a fixed allowlist, so
 *        `versionStatus`, `contentLocale` and `navigation` were absent from
 *        `structuredContent` while the markdown channel carried them.
 *
 * Every case here asserts BOTH channels, because a one-channel fix is what the
 * bug was: the field was present somewhere and absent where it counted. The
 * controls assert that an absent field stays absent — not `null`, not `[]` —
 * since "no trail known" and "a trail with no steps in it" are different
 * answers and a `?? []` fix would give the wrong one.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import {
  createSearchResult,
  createPaginationInfo,
  createTokenInfo,
  createFetchArticleResult,
} from '../../helpers/fixtures.js';

vi.mock('../../../src/core/services/search-service.js', () => ({
  searchDocumentation: vi.fn(),
}));

vi.mock('../../../src/core/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { createMockContext, createMockArticleProvider } from '../../helpers/mock-context.js';
import type {
  ArticleNavigation,
  FetchArticleResult,
  SearchResult,
} from '../../../src/core/types.js';

// ---------------------------------------------------------------------------

interface TextContent { type: 'text'; text: string }

function getTextContent(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const ARTICLE_URL =
  'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html';

/** The default `createSearchResult()` values, for exact-string markdown assertions. */
const RESULT_TITLE = 'Configuration Profiles';
const RESULT_URL = ARTICLE_URL;
const RESULT_SNIPPET = 'Configuration profiles let you manage settings on devices.';

/** A trail deep enough that dropping it makes two hits indistinguishable. */
const BREADCRUMB = ['Jamf Pro', 'Computer Management', 'Overview'];

/**
 * A neighbourhood with a parent and both lists populated, and counts larger
 * than the arrays — the capped case, which is the one a client has to be told
 * about.
 */
const NAVIGATION: ArticleNavigation = {
  self: { title: 'Smart Groups', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Smart_Groups' },
  parent: { title: 'Groups', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Groups' },
  siblings: [{ title: 'Static Groups', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Static_Groups' }],
  children: [{ title: 'Smart Group Criteria', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Smart_Group_Criteria' }],
  siblingCount: 4,
  childCount: 7,
};

function searchResponse(results: SearchResult[]): {
  results: SearchResult[];
  pagination: ReturnType<typeof createPaginationInfo>;
  tokenInfo: ReturnType<typeof createTokenInfo>;
} {
  return {
    results,
    pagination: createPaginationInfo({ totalItems: results.length, totalPages: 1, hasNext: false }),
    tokenInfo: createTokenInfo(),
  };
}

// ---------------------------------------------------------------------------

describe('provider signals reach the client', () => {
  let client: Client;
  let server: McpServer;
  let nextArticle: FetchArticleResult | null;

  beforeAll(async () => {
    nextArticle = null;
    const ctx = createMockContext({
      articleProvider: createMockArticleProvider(() => nextArticle),
    });
    // Fixed IDs so the article path never reaches the network.
    ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
      mapId: 'test-map', contentId: 'test-content', locale: 'en-US',
    });

    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, ctx);
    registerGetArticleTool(server, ctx);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    nextArticle = null;
    vi.mocked(searchDocumentation).mockReset();
  });

  // --- #213: search breadcrumb ---------------------------------------------

  describe('jamf_docs_search breadcrumb (#213)', () => {
    it('should render the trail on the markdown channel, between title and snippet', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([createSearchResult({ breadcrumb: BREADCRUMB })])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      // Exact block rather than a substring: it pins the trail's position, so
      // a later change cannot satisfy this by printing it somewhere a reader
      // scanning a result list will not look.
      expect(getTextContent(result)).toContain(
        `### [${RESULT_TITLE}](${RESULT_URL})\n\n` +
        '*Jamf Pro > Computer Management > Overview*\n\n' +
        `> ${RESULT_SNIPPET}`
      );
    });

    it('should carry the trail on the structured channel', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([createSearchResult({ breadcrumb: BREADCRUMB })])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      const results = structured(result).results as Record<string, unknown>[];
      expect(results[0].breadcrumb).toEqual(BREADCRUMB);
    });

    it('should keep two same-titled hits distinguishable on both channels', async () => {
      // The reason this field exists downstream: `Overview` is a real slug
      // under several products, so title + snippet cannot rank a result list.
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([
          createSearchResult({ title: 'Overview', breadcrumb: ['Jamf Pro', 'Overview'] }),
          createSearchResult({ title: 'Overview', breadcrumb: ['Jamf Protect', 'Overview'] }),
        ])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      const text = getTextContent(result);
      expect(text).toContain('*Jamf Pro > Overview*');
      expect(text).toContain('*Jamf Protect > Overview*');

      const results = structured(result).results as Record<string, unknown>[];
      expect(results.map(r => r.breadcrumb)).toEqual([
        ['Jamf Pro', 'Overview'],
        ['Jamf Protect', 'Overview'],
      ]);
    });

    it('should escape a separator inside a trail segment', async () => {
      // `sanitizeMarkdownText` escapes `>`, so a segment that contains one
      // cannot be read as an extra level of the trail.
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([createSearchResult({ breadcrumb: ['Jamf Pro', 'A > B'] })])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      expect(getTextContent(result)).toContain('*Jamf Pro > A \\> B*');
    });

    // CONTROL --------------------------------------------------------------

    it('CONTROL: should emit nothing on either channel for a result with no trail', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([createSearchResult()])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      // Straight from the heading to the snippet: no blank italic line, which
      // is what a renderer that always printed the trail would leave behind.
      expect(getTextContent(result)).toContain(
        `### [${RESULT_TITLE}](${RESULT_URL})\n\n> ${RESULT_SNIPPET}`
      );

      const results = structured(result).results as Record<string, unknown>[];
      expect(has(results[0], 'breadcrumb')).toBe(false);
    });

    it('CONTROL: should treat an empty trail as no trail, not as an empty one', async () => {
      // A `breadcrumb: r.breadcrumb ?? []` fix passes every assertion above
      // and fails here: `[]` claims the article sits at the root of its map,
      // which is a different answer from "we do not know where it sits".
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchResponse([createSearchResult({ breadcrumb: [] })])
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'overview' } });

      expect(getTextContent(result)).toContain(
        `### [${RESULT_TITLE}](${RESULT_URL})\n\n> ${RESULT_SNIPPET}`
      );

      const results = structured(result).results as Record<string, unknown>[];
      expect(has(results[0], 'breadcrumb')).toBe(false);
    });
  });

  // --- #215: article provider signals ---------------------------------------

  describe('jamf_docs_get_article provider signals (#215)', () => {
    it('should publish versionStatus, contentLocale and navigation on both channels', async () => {
      nextArticle = createFetchArticleResult({
        versionStatus: 'superseded',
        contentLocale: 'en-US',
        navigation: NAVIGATION,
      });

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: ARTICLE_URL, responseFormat: 'json' },
      });

      expect(result.isError).toBeFalsy();

      // Structured channel — the half a program reads, and the half that was
      // dropping all three.
      const sc = structured(result);
      expect(sc.versionStatus).toBe('superseded');
      expect(sc.contentLocale).toBe('en-US');
      expect(sc.navigation).toEqual(NAVIGATION);

      // Text channel, from the same call, so the two cannot drift apart.
      const body = JSON.parse(getTextContent(result)) as Record<string, unknown>;
      expect(body.versionStatus).toBe('superseded');
      expect(body.contentLocale).toBe('en-US');
      expect(body.navigation).toEqual(NAVIGATION);
    });

    it('should publish the signals in markdown mode too, not only for responseFormat=json', async () => {
      // `responseFormat` chooses what the *text* content is; it must not
      // decide whether the structured channel carries provider facts.
      nextArticle = createFetchArticleResult({
        versionStatus: 'latest',
        contentLocale: 'ja-JP',
        navigation: NAVIGATION,
      });

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: ARTICLE_URL },
      });

      const sc = structured(result);
      expect(sc.versionStatus).toBe('latest');
      expect(sc.contentLocale).toBe('ja-JP');
      expect(sc.navigation).toEqual(NAVIGATION);
    });

    it('should carry the capped list counts, not the array lengths', async () => {
      // `siblings` is 1 entry of 4 and `children` 1 of 7 in the fixture. A
      // client that read the array lengths would report the neighbourhood as
      // exhaustive; the counts are the only thing saying it is not.
      nextArticle = createFetchArticleResult({ navigation: NAVIGATION });

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: ARTICLE_URL },
      });

      const nav = structured(result).navigation as ArticleNavigation;
      expect(nav.siblings).toHaveLength(1);
      expect(nav.siblingCount).toBe(4);
      expect(nav.children).toHaveLength(1);
      expect(nav.childCount).toBe(7);
    });

    // CONTROL --------------------------------------------------------------

    it('CONTROL: should omit the signals entirely when the provider set none', async () => {
      // Absent must stay absent. `versionStatus: null` would be read as "known
      // and not latest"; `contentLocale: ''` as a language; `navigation: {}` as
      // a page with no neighbours. All three are claims we cannot make.
      nextArticle = createFetchArticleResult();

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: ARTICLE_URL, responseFormat: 'json' },
      });

      const sc = structured(result);
      expect(has(sc, 'versionStatus')).toBe(false);
      expect(has(sc, 'contentLocale')).toBe(false);
      expect(has(sc, 'navigation')).toBe(false);

      const body = JSON.parse(getTextContent(result)) as Record<string, unknown>;
      expect(has(body, 'versionStatus')).toBe(false);
      expect(has(body, 'contentLocale')).toBe(false);
      expect(has(body, 'navigation')).toBe(false);
    });

    it('CONTROL: should still withhold relatedArticles and the pre-truncation body', async () => {
      // The other way to "stop maintaining an allowlist" is to spread the
      // provider's article wholesale. That would republish the untruncated
      // body next to the preview `content` and hand out the related-article
      // list a caller declined by leaving `includeRelated` off — so the
      // disposition map marks those `replace` and `withhold`, and this pins it.
      nextArticle = createFetchArticleResult({
        content: 'FULL BODY',
        relatedArticles: [{ title: 'Policies', url: 'https://learn.jamf.com/x' }],
      });

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: ARTICLE_URL, outputMode: 'compact' },
      });

      const sc = structured(result);
      expect(has(sc, 'relatedArticles')).toBe(false);
      expect(sc.content).toBe('FULL BODY');
      expect(Object.values(sc).filter(v => v === 'FULL BODY')).toHaveLength(1);
    });
  });
});
