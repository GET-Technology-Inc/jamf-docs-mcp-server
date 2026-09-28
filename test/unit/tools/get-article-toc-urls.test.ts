/**
 * A url `jamf_docs_get_toc` lists, handed to `jamf_docs_get_article`, opens
 * the topic the TOC lists at it.
 *
 * Until 2026-09-28 a url was looked up in its map's topic index by the
 * topic's `legacy_topicname`, or by its title with each run of spaces made
 * `_`. A topic Jamf publishes with no `legacy_topicname`, at an address that
 * is not its title so spelled, could not be opened by its own url:
 * "Configuring the Branding Settings" is published at
 * `Configuring-the-Branding-Settings`, and `jamf_docs_get_article` answered
 * "Topic not found: Configuring-the-Branding-Settings in
 * jamf-pro-documentation-current". A page with a `/` in it, Jamf Pro's
 * `And/Or-Groupings`, was "Unrecognized URL format". Live on 2026-09-28, 49
 * of the 2,579 distinct urls the TOCs of five publications list could not be
 * opened: Jamf Pro 12 of 776, Jamf Connect 7 of 432, Jamf School 1 of 427,
 * Jamf Protect 2 of 379 and Technical Articles 27 of 565. So could 1 of the
 * 427 of Jamf School in ja-JP, whose address is not ASCII and was looked up
 * percent-encoded besides.
 *
 * Now the index holds each topic's own address too, the page of its
 * `readerUrl`, which is what a TOC entry's url and a search result's url
 * name, and a url's page is the rest of its path, read decoded. A
 * `legacy_topicname` outranks an address, and an address a title. Where
 * several topics share one key of a kind, a `legacy_topicname` or an address
 * names the last of them in the `/topics` list, and a title the first.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver
 * and only the http client stubbed. Fixtures: test/fixtures/toc-url-topics.ts.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/index.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  TOC_URL_PUBLICATIONS,
  CONNECT,
  CONNECT_GENERAL_REQUIREMENTS,
  CONNECT_GENERAL_REQUIREMENTS_HYPHENATED,
  CONNECT_TROUBLESHOOTING_LEGACY,
  PRO,
  AND_OR_GROUPINGS,
  SCHOOL_JA,
  TECHNICAL_ARTICLES,
  TECHNICAL_ARTICLES_JA,
  TA_JA_ADDITIONAL_INFORMATION,
  TA_JA_TSUIKA_JOHO,
  LOG_BIN,
  LOG_BIN_LEGACY_NAME,
  MANAGEMENT_ID_TOPICS,
  type TocUrlPublication,
} from '../../fixtures/toc-url-topics.js';

// ── Harness ─────────────────────────────────────────────────────────────────

const BASE = 'https://learn.jamf.com/api/khub';
const PUBLICATIONS = Object.values(TOC_URL_PUBLICATIONS);

/**
 * The topic's own metadata, as `…/topics/{contentId}` sends it: no
 * `readerUrl`, and its address in `ft:prettyUrl`, without the `/r/`.
 */
function topicMetadata(publication: TocUrlPublication, topic: FtTopicInfo): FtTopicInfo {
  const locale = publication.map.metadata?.find(m => m.key === 'ft:locale')?.values[0] ?? 'en-US';
  return {
    ...(topic.title !== undefined ? { title: topic.title } : {}),
    id: topic.id, contentApiEndpoint: topic.contentApiEndpoint,
    metadata: [
      { key: 'ft:locale', label: 'ft:locale', values: [locale] },
      { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: [(topic.readerUrl ?? '').replace(/^\/r\//, '')] },
    ],
  };
}

function upstream(cache: CacheProvider = createMockCache()): ServerContext {
  const json = new Map<string, unknown>([[`${BASE}/maps`, PUBLICATIONS.map(p => p.map)]]);
  const text = new Map<string, string>();
  for (const publication of PUBLICATIONS) {
    const maps = `${BASE}/maps/${encodeURIComponent(publication.map.id)}`;
    json.set(`${maps}/toc`, publication.toc);
    json.set(`${maps}/topics`, publication.topics);
    for (const topic of publication.topics) {
      json.set(`${maps}/topics/${encodeURIComponent(topic.id)}`, topicMetadata(publication, topic));
      text.set(`${maps}/topics/${encodeURIComponent(topic.id)}/content`, `<div class="body"><p>${topic.id}</p></div>`);
    }
  }
  const answer = async <T>(from: Map<string, T>, url: string): Promise<T> => {
    await Promise.resolve();
    if (!from.has(url)) { throw new Error(`offline: no fixture for ${url}`); }
    return from.get(url) as T;
  };
  const http: HttpClient = {
    getJson: async <T>(url: string) => await answer(json, url) as T,
    getText: async (url: string) => await answer(text, url),
    postJson: async (url: string) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return createMockContext({ cache, http, mapsRegistry, topicResolver });
}

interface CallResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

async function withClient<T>(ctx: ServerContext, run: (client: Client) => Promise<T>): Promise<T> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

interface ListedEntry { url: string; contentId: string }

/** The entries `jamf_docs_get_toc` lists for a publication, and the map it read them from. */
async function listed(client: Client, publication: TocUrlPublication): Promise<{ mapId: string; entries: ListedEntry[] }> {
  const result = await client.callTool({ name: 'jamf_docs_get_toc', arguments: publication.tocArgs }) as CallResult;
  expect(result.isError).not.toBe(true);
  const structured = result.structuredContent as { mapId: string; entries: ListedEntry[] };
  return { mapId: structured.mapId, entries: structured.entries };
}

/** What `jamf_docs_get_article` opens at `url`: the pair, or the error it answers. */
async function opened(client: Client, url: string): Promise<{ mapId: string; contentId: string } | string> {
  const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url } }) as CallResult;
  if (result.isError === true) {
    return result.content.map(c => c.text ?? '').join('\n');
  }
  const { mapId, contentId } = result.structuredContent as { mapId: string; contentId: string };
  return { mapId, contentId };
}

/** Each url the TOC lists, with every topic it lists there. */
function topicsByUrl(entries: ListedEntry[]): Map<string, Set<string>> {
  const byUrl = new Map<string, Set<string>>();
  for (const { url, contentId } of entries) {
    byUrl.set(url, (byUrl.get(url) ?? new Set()).add(contentId));
  }
  return byUrl;
}

/** The page of a reader address: what follows `/r/{locale}/{bundle}/`. */
const pageOf = (url: string): string => new URL(url).pathname.split('/').slice(4).join('/');

// ── Every url a TOC lists ───────────────────────────────────────────────────

describe('a url jamf_docs_get_toc lists opens the topic it lists there', () => {
  it.each(Object.entries(TOC_URL_PUBLICATIONS))('%s', async (_name, publication) => {
    const ctx = upstream();

    const outcomes = await withClient(ctx, async (client) => {
      const { mapId, entries } = await listed(client, publication);
      expect(entries.length).toBe(publication.toc.length);
      const byUrl = topicsByUrl(entries);
      const results: [string, unknown, unknown][] = [];
      for (const [url, contentIds] of byUrl) {
        const got = await opened(client, url);
        // Where Jamf publishes several topics at one address, the url cannot
        // say which, and any of them is the topic the TOC lists there.
        const expected = typeof got !== 'string' && contentIds.has(got.contentId)
          ? { mapId, contentId: got.contentId }
          : { mapId, contentId: [...contentIds].join(' or ') };
        results.push([decodeURIComponent(pageOf(url)), got, expected]);
      }
      return results;
    });

    for (const [page, got, expected] of outcomes) {
      expect({ page, opened: got }).toEqual({ page, opened: expected });
    }
  });
});

describe('the address is read as Jamf spells it, not normalised', () => {
  it('General-Requirements and General_Requirements are two topics in Jamf Connect', async () => {
    const ctx = upstream();
    const [hyphenated, underscored] = await withClient(ctx, async client => [
      await opened(client, 'https://learn.jamf.com/r/en-US/jamf-connect-documentation-current/General-Requirements'),
      await opened(client, 'https://learn.jamf.com/r/en-US/jamf-connect-documentation-current/General_Requirements'),
    ]);

    expect(hyphenated).toEqual({ mapId: CONNECT.map.id, contentId: CONNECT_GENERAL_REQUIREMENTS_HYPHENATED });
    expect(underscored).toEqual({ mapId: CONNECT.map.id, contentId: CONNECT_GENERAL_REQUIREMENTS });
  });

  it('a non-ASCII address opens raw, as get_toc lists it, and percent-encoded, as a browser copies it', async () => {
    const raw = 'https://learn.jamf.com/r/ja-JP/jamf-school-documentation/Jamf-School-から管理者テータを削除する';
    const encoded = new URL(raw).href;
    expect(encoded).not.toBe(raw);

    const ctx = upstream();
    const [fromRaw, fromEncoded] = await withClient(ctx, async client => [
      await opened(client, raw),
      await opened(client, encoded),
    ]);

    const want = { mapId: SCHOOL_JA.map.id, contentId: 'dm9T07Iv_tPq_rjTO~C80A' };
    expect(fromRaw).toEqual(want);
    expect(fromEncoded).toEqual(want);
  });

  it('a topic whose legacy_topicname is not its address opens by both', async () => {
    const ctx = upstream();
    const [byAddress, byLegacyUrl] = await withClient(ctx, async client => [
      await opened(client, `https://learn.jamf.com${TECHNICAL_ARTICLES.toc[2].prettyUrl}`),
      await opened(client, `https://learn.jamf.com/en-US/bundle/technical-articles/page/${LOG_BIN_LEGACY_NAME}.html`),
    ]);

    const want = { mapId: TECHNICAL_ARTICLES.map.id, contentId: LOG_BIN };
    expect(byAddress).toEqual(want);
    expect(byLegacyUrl).toEqual(want);
  });

  it('a page encoded whole, its `/` included, opens as Jamf spells it', async () => {
    // As `encodeURIComponent` writes the page: `And%2FOr-Groupings`.
    const encoded = `https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/${encodeURIComponent('And/Or-Groupings')}`;
    expect(new URL(encoded).pathname).toContain('%2F');

    const ctx = upstream();
    const got = await withClient(ctx, async client => await opened(client, encoded));

    expect(got).toEqual({ mapId: PRO.map.id, contentId: AND_OR_GROUPINGS });
  });
});

// ── Which key names a page ──────────────────────────────────────────────────

describe('an address outranks a title', () => {
  // Five Technical Articles topics in ja-JP are titled 追加情報. The first is
  // published at `Additional_Information`, and its title key, 追加情報, is the
  // address of the fifth, which has no legacy_topicname. The url of that
  // address opens the topic published there. Ranked the other way, it would
  // open the first, which the TOC does not list at that url, and so would 8
  // urls the ja-JP and zh-TW TOCs of Jamf Connect and Technical Articles
  // list, this one among them (live, 2026-09-28).
  it('追加情報 opens the topic published at it, not the first one titled so', async () => {
    const ctx = upstream();
    const got = await withClient(ctx, async client =>
      await opened(client, 'https://learn.jamf.com/r/ja-JP/technical-articles/追加情報'));

    expect(got).toEqual({ mapId: TECHNICAL_ARTICLES_JA.map.id, contentId: TA_JA_TSUIKA_JOHO });
  });
});

// ── What does not change ────────────────────────────────────────────────────

describe('a url that opened a topic before opens the same one', () => {
  // A legacy_topicname outranks the other keys, so a key one gave names the
  // topic it named before. A title does not: an address can displace it. Of
  // the 4,278 keys the indexes of seven publications held, built from their
  // topics as served on 2026-09-28, none was displaced. In Jamf Connect and
  // Technical Articles in ja-JP and zh-TW, 9 title keys were, such as 追加情報
  // above, none of them ASCII, and no url reached them before: a url's page
  // was looked up percent-encoded.
  //
  // Two topics are published at `Troubleshooting`, and only the one with that
  // `legacy_topicname` was reachable by it. It still is.
  it('a Jamf Connect url two topics share, one of them by legacy_topicname', async () => {
    const ctx = upstream();
    const got = await withClient(ctx, async client =>
      await opened(client, 'https://learn.jamf.com/r/en-US/jamf-connect-documentation-current/Troubleshooting'));

    expect(got).toEqual({ mapId: CONNECT.map.id, contentId: CONNECT_TROUBLESHOOTING_LEGACY });
  });

  it('a legacy_topicname several topics share names the last of them', async () => {
    const ctx = upstream();
    const [byAddress, byLegacyUrl] = await withClient(ctx, async client => [
      await opened(client, 'https://learn.jamf.com/r/ja-JP/technical-articles/Additional_Information'),
      await opened(client, 'https://learn.jamf.com/ja-JP/bundle/technical-articles/page/Additional_Information.html'),
    ]);

    const want = { mapId: TECHNICAL_ARTICLES_JA.map.id, contentId: TA_JA_ADDITIONAL_INFORMATION[3] };
    expect(byAddress).toEqual(want);
    expect(byLegacyUrl).toEqual(want);
  });

  it('a title several topics share names the first of them', async () => {
    // Both topics at `Obtaining-the-Management-ID` are titled "Obtaining the
    // Management ID", and neither has a legacy_topicname or an address
    // spelled `Obtaining_the_Management_ID`.
    const ctx = upstream();
    const got = await withClient(ctx, async client =>
      await opened(client, 'https://learn.jamf.com/r/en-US/technical-articles/Obtaining_the_Management_ID'));

    expect(got).toEqual({ mapId: TECHNICAL_ARTICLES.map.id, contentId: MANAGEMENT_ID_TOPICS[0] });
  });
});

describe('a url several topics share', () => {
  // Jamf publishes the two topics at `Obtaining-the-Management-ID`, neither
  // with a legacy_topicname, and the url cannot say which it means; the
  // `mapId` + `contentId` pair can. Until 2026-09-28 it opened neither. It
  // opens the last of them in the list now, as a shared legacy_topicname does.
  it('an address several topics share, none by legacy_topicname, names the last of them', async () => {
    const ctx = upstream();
    const got = await withClient(ctx, async client =>
      await opened(client, 'https://learn.jamf.com/r/en-US/technical-articles/Obtaining-the-Management-ID'));

    expect(got).toEqual({ mapId: TECHNICAL_ARTICLES.map.id, contentId: MANAGEMENT_ID_TOPICS[1] });
  });
});

// ── An index cached before ──────────────────────────────────────────────────

describe('an index an earlier build cached is not read', () => {
  it('a url its topics were indexed without opens after an upgrade', async () => {
    // What a build before 2026-09-28 cached for Jamf Connect: every address a
    // legacy_topicname or a title gives, and not `Getting-Started`. It kept
    // it for CACHE_TTL_ARTICLE, 24 hours by default.
    const cache = createMockCache();
    await cache.set(
      `ft-topic-index:${JSON.stringify({ mapId: CONNECT.map.id })}` as CacheKey,
      [
        ['Getting_Started', 'OBw7onvwMST3UmyynYjl~A'],
        ['General_Requirements', CONNECT_GENERAL_REQUIREMENTS],
        ['Troubleshooting', CONNECT_TROUBLESHOOTING_LEGACY],
      ],
      24 * 60 * 60 * 1000,
    );

    const got = await withClient(upstream(cache), async client =>
      await opened(client, 'https://learn.jamf.com/r/en-US/jamf-connect-documentation-current/Getting-Started'));

    expect(got).toEqual({ mapId: CONNECT.map.id, contentId: 'OBw7onvwMST3UmyynYjl~A' });
  });
});
