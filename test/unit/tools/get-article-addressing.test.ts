/**
 * What `jamf_docs_get_article` says about the article it returns: which page
 * it is, and what a missed `section` offers instead.
 *
 * Two defects, both measured against the live sites on 2026-09-24 and both
 * invisible to the existing tests, which asserted which resolver calls were
 * made and used fixtures with headings:
 *
 *   1. `url` plus a `mapId` + `contentId` pair. On learn.jamf.com the pair was
 *      fetched and the article labelled with the url — a Policies.html url and
 *      the Computer Configuration Profiles pair returned the latter under the
 *      former's link, on every channel. A pair alone returned `url: ""` and
 *      `*Source: [](#)*`. On concepts/support the pair was dropped silently.
 *   2. A missed `section` on a heading-free topic printed "**Available
 *      sections:**" over nothing. 94% of sampled learn.jamf.com topics have no
 *      heading; the sub-sections a reader sees are child topics, which the
 *      response had already placed in `navigation` and never offered.
 *
 * So every case here drives the registered tool end to end — real
 * article-service, parser and formatter, HTTP mocked underneath — and asserts
 * what a client reads: the markdown, the JSON text and `structuredContent`.
 *
 * Fixtures are live payloads captured 2026-09-24, trimmed to the fields the
 * code reads. The topic metadata carries no `readerUrl`, because the live
 * single-topic endpoint sends none.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    ...actual,
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
  };
});

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { httpGetJson, httpGetText, HttpError } from '../../../src/core/http-client.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../../fixtures/concepts-guide-page.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FtMetadataEntry, FtTocNode, FtTopicInfo } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);

// ── Live identifiers (2026-09-24) ───────────────────────────────────────────

/** Jamf Pro Documentation 11.32.0, en-US, and its ja-JP counterpart. */
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRO_MAP_JA = 'GE9~jUeMhje7axrw1dW5VA';
/** Technical paper: Local Administrator Password Solution for Jamf Pro. */
const LAPS_MAP = '1ZN5bkFvUa6baRoUXR6Zog';

const CCP = 'fFa7Mu0YJW87Bs~ZXE_j2Q';
const POLICIES = '0Kv7TU1RQ7Sd8J2yMYv8Ew';
const POLICIES_JA = '5j4iXKsKVvDiCZ055Zr_xA';
const USE_LAPS = 'cS8N6f3zVb5pvf0xGCi_ug';

const POLICIES_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
const CCP_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Computer_Configuration_Profiles.html';
const CCP_OWN = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles';
const POLICIES_JA_OWN = 'https://learn.jamf.com/r/ja-JP/jamf-pro-documentation-current/Policies';
/** A search result's url for "Use LAPS" — a slug two topics in the map share. */
const USING_LAPS_URL = 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The nine children of Computer Configuration Profiles, in TOC order. */
const CCP_CHILDREN: FtTocNode[] = [
  ['aHcXwrQyqrcQ2D2EdCMDMw', '3Mpui0ZOoQ3uGb7cGLsTfQ', 'Payload Variables for Configuration Profiles', 'Payload_Variables_for_macOS_Configuration_Profiles'],
  ['_8WC9PXcqdD2X4XsobK9Yw', 'o151BksE0LcObjYlsr~qZA', 'General Requirements', 'GenReq_ConfigurationProfiles'],
  ['2JZZTtUS9I8p2giBSwU_fQ', 'v50nLP18~OletJXXnqIA1w', 'Creating a Computer Configuration Profile in Jamf Pro', 'Manually_Creating_a_Configuration_Profile_macOS'],
  ['dT6fHhDN_pjVZp853z51zw', 'b5PDi2GCMUSyh2CUh~qNVQ', 'Uploading a Configuration Profile', 'Uploading_a_Configuration_Profile_macOS'],
  ['G8HplcHA6xHIULqeC5jU9w', 'ttd37oezfA_GOJTovqjqJg', 'Editing the Settings or Scope of a Configuration Profile', 'Editing_the_Settings_or_Scope_of_a_Configuration_Profile_macOS'],
  ['GTmgmp8yRi~MfkSVGA1C3A', 'eZGvEE25TuCm~lHfBok4KQ', 'Downloading a Configuration Profile', 'Downloading-a-Configuration-Profile'],
  ['SuxinLUtxHtNYe3Un~jzMw', 'XFEgU~UjMrMqU63LZjr3gA', 'Viewing the Status of a Configuration Profile', 'Viewing-the-Status-of-a-Configuration-Profile'],
  ['ikjp2h3NYjHdYIAwn1etXw', 'bCqoSPHrfqtXEXqKT43EuQ', 'Troubleshooting a Failed Status of a Configuration Profile', 'Troubleshooting_a_Failed_Status_of_a_Configuration_Profile'],
  ['tUX1Oo8q_xDaOn7Ge1oXJA', '2aaPG7B2hnyp_D0cKRsUDg', 'Adding a Computer Configuration Profile to the Jamf Pro Dashboard', 'Adding_a_Computer_Configuration_Policy_to_the_Jamf_Pro_Dashboard'],
].map(([tocId, contentId, title, slug]) => ({
  tocId, contentId, title,
  prettyUrl: `/r/en-US/jamf-pro-documentation-current/${slug}`,
}));

const TOCS: Record<string, FtTocNode[]> = {
  [PRO_MAP]: [{
    tocId: 'managing-computers', contentId: 'managing-computers-topic', title: 'Managing Computers',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Managing_Computers',
    children: [
      {
        tocId: '29eZhNisNhAykqfEi9dP_w', contentId: POLICIES, title: 'Policies',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Policies',
      },
      {
        tocId: 'ccHIl700Hz_GM3SLvzTKzA', contentId: CCP, title: 'Computer Configuration Profiles',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles',
        children: CCP_CHILDREN,
      },
    ],
  }],
  [PRO_MAP_JA]: [{
    tocId: 'X0J6QXaT5MVKAhdMtgAaIg', contentId: POLICIES_JA, title: 'ポリシー',
    prettyUrl: '/r/ja-JP/jamf-pro-documentation-current/Policies',
  }],
  // "Use LAPS" and its child "Using LAPS in the Jamf Pro API" publish under the
  // same `Using_LAPS` slug, so resolving that url alone lands on the child.
  [LAPS_MAP]: [{
    tocId: 'VN~_HlL~gTRFdtIP~ZP3kw', contentId: USE_LAPS, title: 'Use LAPS',
    prettyUrl: '/r/en-US/technical-paper-laps-current/Using_LAPS',
    children: [{
      tocId: 'pZaUv5ZbiUCDcZprz9NILw', contentId: 'XD_dFGbPnBjOLmq~fF_mSw',
      title: 'Using LAPS in the Jamf Pro API',
      prettyUrl: '/r/en-US/technical-paper-laps-current/Using_LAPS',
    }],
  }],
};

function metadata(prettyUrl: string, locale: string): FtMetadataEntry[] {
  return [
    { key: 'version', label: 'version', values: ['11.32.0'] },
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
    { key: 'ft:lastEdition', label: 'ft:lastEdition', values: ['2025-07-31'] },
    { key: 'ft:locale', label: 'ft:locale', values: [locale] },
    { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: [prettyUrl] },
  ];
}

/** `title, id, contentApiEndpoint, metadata` — the live payload has no `readerUrl`. */
function topic(mapId: string, id: string, title: string, prettyUrl: string, locale = 'en-US'): FtTopicInfo {
  return {
    title, id,
    contentApiEndpoint: `/api/khub/maps/${mapId}/topics/${id}/content`,
    metadata: metadata(prettyUrl, locale),
  };
}

const TOPICS: Record<string, FtTopicInfo> = {
  [CCP]: topic(PRO_MAP, CCP, 'Computer Configuration Profiles', 'en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles'),
  [POLICIES]: topic(PRO_MAP, POLICIES, 'Policies', 'en-US/jamf-pro-documentation-current/Policies'),
  [POLICIES_JA]: topic(PRO_MAP_JA, POLICIES_JA, 'ポリシー', 'ja-JP/jamf-pro-documentation-current/Policies', 'ja-JP'),
  [USE_LAPS]: topic(LAPS_MAP, USE_LAPS, 'Use LAPS', 'en-US/technical-paper-laps-current/Using_LAPS'),
};

/**
 * `GET …/topics/fFa7Mu0YJW87Bs~ZXE_j2Q/content`, verbatim: 2003 bytes, one
 * `div.body.conbody` of four paragraphs and a related-links nav, and not one
 * `<h1>`–`<h6>`. What the site shows as its nine procedures are its children.
 */
const CCP_HTML = '<div class="content-locale-en-US content-locale-en"><div id="ID-00022bba"><div class="body conbody">'
  + '<p class="p">Configuration profiles are XML files (<span class="ph filepath">.mobileconfig</span>) that provide an easy way to define settings and restrictions for devices, computers, and users.</p>'
  + '<p class="p">You can use <span class="ph">Jamf Pro</span> to create a configuration profile or you can upload a configuration profile that was created using third-party software.</p>'
  + '<p class="p">When you create a computer configuration profile, you must specify the level at which to apply the profile—computer-level or user-level. Each level has a unique set of payloads and a few that are common to both. User-level profiles may not apply until the MDM-enabled user logs out of the computer and logs back in, or when the computer is restarted.</p>'
  + '<p class="p">There are two different ways to distribute a configuration profile: install it automatically (requires no interaction from the user) or make it available in Self Service.</p>'
  + '</div><nav role="navigation" class="related-links"><div class="relinfo linklist"><strong>Related content</strong><ul class="linklist">'
  + '<li class="linklist"><a class="link ft-external-link" href="https://learn.jamf.com/bundle/technical-articles/page/Deploying_Custom_Computer_Configuration_Profiles_Using_the_Application_and_Custom_Settings_Payload.html" target="_blank" rel="noopener">Deploying Custom Computer Configuration Profiles Using the Application and Custom Settings Payload</a></li>'
  + '</ul></div></nav></div></div>';

const OTHER_HTML = '<div class="body conbody"><p class="p">Body.</p></div>';

// ── Per-test state and routing ──────────────────────────────────────────────

let topics: Record<string, FtTopicInfo>;
let tocUnavailable: boolean;

function route(): void {
  mockedGetJson.mockImplementation(async (url: string) => {
    await Promise.resolve();
    const path = decodeURIComponent(new URL(url).pathname);
    const toc = /^\/api\/khub\/maps\/([^/]+)\/toc$/.exec(path);
    if (toc !== null) {
      if (tocUnavailable) {
        throw new HttpError(503, 'Service Unavailable', url);
      }
      return Object.hasOwn(TOCS, toc[1]) ? TOCS[toc[1]] : [];
    }
    const id = /^\/api\/khub\/maps\/[^/]+\/topics\/([^/]+)$/.exec(path)?.[1];
    if (id !== undefined && Object.hasOwn(topics, id)) {
      return topics[id];
    }
    throw new Error(`Unexpected GET JSON: ${url}`);
  });
  mockedGetText.mockImplementation(async (url: string) => {
    await Promise.resolve();
    if (url === CONCEPTS_GUIDE_URL) {
      return CONCEPTS_GUIDE_HTML;
    }
    const content = /\/topics\/([^/]+)\/content$/.exec(decodeURIComponent(new URL(url).pathname));
    if (content !== null) {
      return content[1] === CCP ? CCP_HTML : OTHER_HTML;
    }
    throw new Error(`Unexpected GET text: ${url}`);
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface TextContent { type: 'text'; text: string }
type Args = Record<string, unknown>;

let client: Client;
let ctx: ServerContext;
const resolve = vi.fn();

/**
 * The url resolutions these tests need. Resolving a url is the topic
 * resolver's job and has its own tests; what matters here is what the article
 * is labelled with once something has chosen the topic.
 */
resolve.mockImplementation(async (input: { url?: string; locale?: string }) => {
  await Promise.resolve();
  if (input.url === POLICIES_URL) {
    return input.locale === 'ja-JP'
      ? { mapId: PRO_MAP_JA, contentId: POLICIES_JA, locale: 'ja-JP' }
      : { mapId: PRO_MAP, contentId: POLICIES, locale: 'en-US' };
  }
  if (input.url === CCP_URL) {
    return { mapId: PRO_MAP, contentId: CCP, locale: 'en-US' };
  }
  throw new Error(`Unexpected resolve: ${JSON.stringify(input)}`);
});

beforeAll(async () => {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  ctx = createMockContext();
  ctx.topicResolver.resolve = resolve;
  registerGetArticleTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  topics = { ...TOPICS };
  tocUnavailable = false;
  // Each case starts cold, so no answer is a cached one from an earlier case.
  await ctx.cache.clear();
  route();
});

async function call(args: Args): Promise<{ text: string; sc: Record<string, unknown>; isError: unknown }> {
  const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: args });
  return {
    text: (result.content[0] as TextContent).text,
    sc: (result.structuredContent ?? {}) as Record<string, unknown>,
    isError: result.isError,
  };
}

/** Every channel's idea of which page this is. */
async function labels(args: Args): Promise<{ markdown: string; compact: string; json: string; structured: unknown }> {
  const full = await call(args);
  const compact = await call({ ...args, outputMode: 'compact' });
  const json = await call({ ...args, responseFormat: 'json' });
  return {
    markdown: full.text,
    compact: compact.text,
    json: (JSON.parse(json.text) as { url: string }).url,
    structured: full.sc.url,
  };
}

// ── url + mapId/contentId ───────────────────────────────────────────────────

describe('get_article with a url and a mapId + contentId pair', () => {
  it('labels the article with the pair\'s own address on every channel, not with the url', async () => {
    const out = await labels({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP });

    expect(out.structured).toBe(CCP_OWN);
    expect(out.json).toBe(CCP_OWN);
    expect(out.markdown).toContain(`(${CCP_OWN})*`);
    expect(out.compact).toContain(`[Source](${CCP_OWN})`);
    for (const channel of [out.markdown, out.compact]) {
      expect(channel).not.toContain('Policies.html');
    }
    // The pair decided; the url was never resolved.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('says the url it was given went unused when it does not match the article', async () => {
    const { text, sc } = await call({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP });

    expect(sc.title).toBe('Computer Configuration Profiles');
    expect(text).toContain('fetched by its mapId + contentId');
    expect(text).toContain('was not used');
  });

  it('accepts a search result\'s url, mapId and contentId together, even when two topics share its slug', async () => {
    // Live: resolving `…/Using_LAPS` alone lands on "Using LAPS in the Jamf Pro
    // API", the child that shares the slug. The pair names "Use LAPS", which
    // is the result the url came with — so the pair decides, and a url that is
    // this article's own raises nothing.
    const { text, sc, isError } = await call({ url: USING_LAPS_URL, mapId: LAPS_MAP, contentId: USE_LAPS });

    expect(isError).toBeFalsy();
    expect(sc.title).toBe('Use LAPS');
    expect(sc.url).toBe(USING_LAPS_URL);
    expect(text).not.toContain('Note:');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('labels a pair-only fetch with its own address instead of an empty link', async () => {
    const out = await labels({ mapId: PRO_MAP, contentId: CCP });

    expect(out.structured).toBe(CCP_OWN);
    expect(out.json).toBe(CCP_OWN);
    expect(out.markdown).toContain('*Source: [');
    expect(out.markdown).not.toContain('[](#)');
  });

  it('takes the address from the topic\'s own metadata, so it holds when the TOC will not load', async () => {
    // `ft:prettyUrl` is on the single-topic payload: 129 of 129 topics sampled
    // across seven maps carried it, and `/r/` + it was the TOC's URL each time.
    tocUnavailable = true;

    const { sc, text } = await call({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP });

    expect(sc.navigation).toBeUndefined();
    expect(sc.url).toBe(CCP_OWN);
    expect(text).toContain('was not used');
  });

  it('takes the address from the TOC when the topic metadata has none', async () => {
    topics[CCP] = { ...TOPICS[CCP], metadata: [] };

    const { sc } = await call({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP });

    expect(sc.url).toBe(CCP_OWN);
  });

  it('prints no Source link, rather than an empty one, when no address is known', async () => {
    topics[CCP] = { ...TOPICS[CCP], metadata: [] };
    tocUnavailable = true;

    const full = await call({ mapId: PRO_MAP, contentId: CCP });
    const compact = await call({ mapId: PRO_MAP, contentId: CCP, outputMode: 'compact' });

    expect(full.sc.url).toBe('');
    expect(full.text).not.toContain('Source:');
    expect(full.text).not.toContain('(#)');
    expect(full.text).toMatch(/\*\d+ tokens\*\n$/);
    expect(compact.text).not.toContain('[Source]');
  });

  it('says `language` does not apply to a pair, instead of blaming the url', async () => {
    const { text } = await call({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP, language: 'ja-JP' });

    expect(text).toContain('`language` has no effect on a mapId + contentId pair');
    expect(text).toContain('"en-US"');
    expect(text).not.toContain('resolved from a "en-US" URL');
  });

  it('says nothing about `language` when the pair\'s map is in that language', async () => {
    const { text } = await call({ mapId: PRO_MAP, contentId: CCP, language: 'en-US' });

    expect(text).not.toContain('Note:');
  });

  it('says the pair was ignored when the url is on a static source', async () => {
    const { text, sc } = await call({ url: CONCEPTS_GUIDE_URL, mapId: PRO_MAP, contentId: CCP });

    expect(sc.url).toBe(CONCEPTS_GUIDE_URL);
    expect(sc.mapId).toBeUndefined();
    expect(text).toContain('mapId and contentId were ignored');
    expect(text).toContain('concepts.jamf.com url is fetched by url alone');
  });
});

describe('get_article with a url alone', () => {
  it('keeps the caller\'s url when the url is what chose the article', async () => {
    const { sc, text } = await call({ url: POLICIES_URL });

    expect(sc.title).toBe('Policies');
    expect(sc.url).toBe(POLICIES_URL);
    expect(text).not.toContain('Note:');
  });

  it('labels an article `language` moved to another map with that map\'s page', async () => {
    // Live: ポリシー from the ja-JP map, under the en-US Policies.html link.
    const { sc, text } = await call({ url: POLICIES_URL, language: 'ja-JP' });

    expect(sc.title).toBe('ポリシー');
    expect(sc.url).toBe(POLICIES_JA_OWN);
    expect(text).toContain(`(${POLICIES_JA_OWN})*`);
  });
});
