/**
 * What `language` does to a concepts.jamf.com or support.jamf.com url in
 * `jamf_docs_get_article` and `jamf_docs_batch_get_articles`: the registered
 * tools over MCP, with the real article readers and cache, and only the http
 * client stubbed with the two sites as they address a page's editions
 * (helpers/static-editions-upstream.ts).
 *
 * On learn.jamf.com, `language` overrides the locale in the url: live on
 * 2026-09-28, the en-US Policies.html with `language: "ja-JP"` came back as
 * ポリシー from its own ja-JP address, and with `"th-TH"`, which has no map,
 * as the en-US Policies with a note that says so. Until 2026-09-28 a static
 * url ignored `language` without a word. `/en/guides/ai-governance/` asked
 * for in ja-JP, zh-CN or th-TH came back as the English page with no note,
 * though concepts.jamf.com publishes it in ja and zh-CN, and so did a
 * support.jamf.com article that has a ja edition. So did a support.jamf.com
 * `/ja/` url of an article with no ja edition, which the site answers with
 * the en edition, labelled with the `/ja/` url.
 *
 * Now the requested locale's edition is served where the site has one, and
 * otherwise the page asked for, with a note naming the edition it is.
 * `contentLocale` says which edition was served, as an `ArticleProvider`'s
 * answer does. An edition that cannot be read is never the call's failure:
 * the page asked for is served in its place, with a note.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants/locales.js';
import { HttpError } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  ENGLISH_ONLY_PATH,
  aiGovernanceBody,
  conceptsUrl,
  createStaticEditionsUpstream,
  editionUrl,
  servedAt,
} from '../../helpers/static-editions-upstream.js';
import { nextDataPage } from '../../helpers/support-upstream.js';
import { JC_LOGIN_BLACK_SCREEN, RENEW_PUSH_CERTIFICATE } from '../../fixtures/support-editions.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

const AI_GOVERNANCE = 'guides/ai-governance';
const AI_GOVERNANCE_EN = conceptsUrl('en', AI_GOVERNANCE);

/** Each locale id and the code a source spells it with, for the ones it publishes in. */
function declared(source: { locales: Readonly<Record<string, string>> }): [string, string][] {
  return Object.entries(source.locales);
}

/** The `language` values a source's locale table leaves out. */
function undeclared(source: { locales: Readonly<Record<string, string>> }): string[] {
  return SUPPORTED_LOCALE_IDS.filter(id => !(id in source.locales));
}

/** The note an article served in another language than the one asked for ends with. */
function editionNote(requested: string, served: string): string {
  return `Jamf does not publish this article in ${requested}. Showing the ${served} edition instead.`;
}

/** The note on an article served in place of its `requested` edition, which failed with `why`. */
function unreadNote(requested: string, why: string, served: string): string {
  return `The ${requested} edition of this article could not be read (${why}). Showing the ${served} edition instead.`;
}

/** What each way an edition can fail throws, and how the note words it. */
const EDITION_FAILURES: [string, (url: string) => () => never, string][] = [
  ['a 503 after the retries', url => () => { throw new HttpError(503, 'Service Unavailable', url); }, 'HTTP 503 Service Unavailable'],
  // What `AbortSignal.timeout` rejects a fetch with.
  ['a timeout', () => () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }, 'the request timed out'],
];

const upstream = createStaticEditionsUpstream();
const { requests } = upstream;

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http: upstream.http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing the tools first is what makes the client check every
  // `structuredContent` against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  upstream.reset();
});

async function getArticle(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_get_article', arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

interface Channel { url: string; title: string; text: string; contentLocale?: string | undefined }

/** The article as each channel carries it: markdown, the JSON text, and structuredContent. */
async function everyChannel(args: Record<string, unknown>): Promise<Channel[]> {
  const markdown = await getArticle({ ...args, responseFormat: 'markdown' });
  const json = await getArticle({ ...args, responseFormat: 'json' });
  for (const result of [markdown, json]) {
    expect(result.isError, textOf(result)).not.toBe(true);
  }
  const fromMarkdown = markdown.structuredContent as unknown as Channel & { content: string };
  const body = JSON.parse(textOf(json)) as Channel & { content: string };
  const structured = json.structuredContent as unknown as Channel & { content: string };
  return [
    { url: fromMarkdown.url, title: fromMarkdown.title, text: textOf(markdown), contentLocale: fromMarkdown.contentLocale },
    { url: body.url, title: body.title, text: body.content, contentLocale: body.contentLocale },
    { url: structured.url, title: structured.title, text: structured.content, contentLocale: structured.contentLocale },
  ];
}

// ── concepts.jamf.com ──────────────────────────────────────────────────────

describe('jamf_docs_get_article: `language` on a concepts.jamf.com url', () => {
  it.each(declared(CONCEPTS))('serves the %s edition, the same path under %s, with no note', async (language, code) => {
    const edition = conceptsUrl(code, AI_GOVERNANCE);

    for (const channel of await everyChannel({ url: AI_GOVERNANCE_EN, language })) {
      expect(channel.url).toBe(edition);
      expect(channel.text).toContain(aiGovernanceBody(code));
      expect(channel.text).not.toContain('Jamf does not publish');
      expect(channel.contentLocale).toBe(language);
    }
    // One page: the edition, and not the page the url names first.
    expect(requests).toEqual([edition]);
  });

  it.each(undeclared(CONCEPTS))('serves the page asked for in %s, which the site does not publish, and says so', async (language) => {
    for (const channel of await everyChannel({ url: AI_GOVERNANCE_EN, language })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).toContain(editionNote(language, 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual([AI_GOVERNANCE_EN]);
  });

  it('serves the en-US edition of a ja url asked for in en-US', async () => {
    for (const channel of await everyChannel({ url: conceptsUrl('ja', AI_GOVERNANCE), language: 'en-US' })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).not.toContain('Jamf does not publish');
      expect(channel.contentLocale).toBe('en-US');
    }
  });

  it('serves the page asked for, with the note, when the site has no edition of it in the language', async () => {
    const english = conceptsUrl('en', ENGLISH_ONLY_PATH);

    for (const channel of await everyChannel({ url: english, language: 'ja-JP' })) {
      expect(channel.url).toBe(english);
      expect(channel.title).toBe('English Only');
      expect(channel.text).toContain(editionNote('ja-JP', 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(new Set(requests)).toEqual(new Set([conceptsUrl('ja', ENGLISH_ONLY_PATH), english]));
  });

  it('is unchanged without a language, or in the url\'s own', async () => {
    for (const args of [{ url: AI_GOVERNANCE_EN }, { url: AI_GOVERNANCE_EN, language: 'en-US' }]) {
      for (const channel of await everyChannel(args)) {
        expect(channel.url).toBe(AI_GOVERNANCE_EN);
        expect(channel.text).toContain(aiGovernanceBody('en'));
        expect(channel.text).not.toContain('*Note:');
        // New beside the unchanged reply: which edition it is.
        expect(channel.contentLocale).toBe('en-US');
      }
    }
    expect(requests).toEqual([AI_GOVERNANCE_EN]);
  });

  it('says the language was not applied to a url whose path names no locale', async () => {
    const unprefixed = `${CONCEPTS.baseUrl}/${AI_GOVERNANCE}/`;

    for (const channel of await everyChannel({ url: unprefixed, language: 'ja-JP' })) {
      expect(channel.url).toBe(unprefixed);
      expect(channel.text).toContain('Language "ja-JP" was not applied');
      expect(channel.contentLocale).toBeUndefined();
    }
    expect(requests).toEqual([unprefixed]);
  });

  // The sitemap lists every page under ko and pl too (2026-09-28), which no
  // `language` value names; see `otherLocales` in sources.ts.
  it('serves the ja-JP edition of a url under a code the site publishes in but no language names', async () => {
    const korean = conceptsUrl('ko', AI_GOVERNANCE);

    for (const channel of await everyChannel({ url: korean, language: 'ja-JP' })) {
      expect(channel.url).toBe(conceptsUrl('ja', AI_GOVERNANCE));
      expect(channel.text).toContain(aiGovernanceBody('ja'));
      expect(channel.text).not.toContain('*Note:');
      expect(channel.contentLocale).toBe('ja-JP');
    }
    expect(requests).toEqual([conceptsUrl('ja', AI_GOVERNANCE)]);
  });

  it('serves such a url as it is, in a language the site does not publish in, and says so', async () => {
    const polish = conceptsUrl('pl', AI_GOVERNANCE);

    for (const channel of await everyChannel({ url: polish, language: 'th-TH' })) {
      expect(channel.url).toBe(polish);
      expect(channel.text).toContain(aiGovernanceBody('pl'));
      expect(channel.text).toContain('Jamf does not publish this article in th-TH. Showing the page this url names instead.');
      // No `language` value names pl, so nothing says it is.
      expect(channel.contentLocale).toBeUndefined();
    }
    for (const channel of await everyChannel({ url: polish })) {
      expect(channel.url).toBe(polish);
      expect(channel.text).not.toContain('*Note:');
    }
    expect(requests).toEqual([polish]);
  });

  it('keeps a url\'s fragment on the page it names, and leaves it off another edition', async () => {
    const fragment = `${AI_GOVERNANCE_EN}#overview`;

    for (const channel of await everyChannel({ url: fragment })) {
      expect(channel.url).toBe(fragment);
    }
    for (const channel of await everyChannel({ url: fragment, language: 'ja-JP' })) {
      expect(channel.url).toBe(conceptsUrl('ja', AI_GOVERNANCE));
      expect(channel.text).toContain(aiGovernanceBody('ja'));
    }
  });

  it('fails as the page asked for fails when neither edition is there', async () => {
    const missing = conceptsUrl('en', 'guides/no-such-guide');
    const result = await getArticle({ url: missing, language: 'ja-JP' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`HTTP 404: ${missing}`);
  });
});

// ── support.jamf.com ───────────────────────────────────────────────────────

const RENEW_EN = canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, 'en'));
const RENEW_JA = canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, 'ja'));
const JC_LOGIN_EN = canonicalStaticUrl(SUPPORT, editionUrl(JC_LOGIN_BLACK_SCREEN, 'en'));

describe('jamf_docs_get_article: `language` on a support.jamf.com url', () => {
  it.each(declared(SUPPORT).filter(([id]) => id !== 'en-US'))(
    'serves the %s edition of an article the site publishes in %s, from the address the page lists',
    async (language, code) => {
      const edition = canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, code));

      for (const channel of await everyChannel({ url: RENEW_EN, language })) {
        expect(channel.url).toBe(edition);
        expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions[code].title);
        expect(channel.text).not.toContain('Jamf does not publish');
        expect(channel.contentLocale).toBe(language);
      }
      // The page asked for, whose `localeLinks` names the edition, and the edition.
      expect(requests).toEqual([RENEW_EN, edition]);
    },
  );

  it('serves the en-US edition of an article that has no ja edition, and says so', async () => {
    for (const channel of await everyChannel({ url: JC_LOGIN_EN, language: 'ja-JP' })) {
      expect(channel.url).toBe(JC_LOGIN_EN);
      expect(channel.title).toBe(JC_LOGIN_BLACK_SCREEN.editions.en.title);
      expect(channel.text).toContain(editionNote('ja-JP', 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    // `localeLinks` says there is no ja edition, so none is asked for.
    expect(requests).toEqual([JC_LOGIN_EN]);
  });

  it.each(undeclared(SUPPORT))('serves the page asked for in %s, which the site does not publish, and says so', async (language) => {
    for (const channel of await everyChannel({ url: RENEW_EN, language })) {
      expect(channel.url).toBe(RENEW_EN);
      expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions.en.title);
      expect(channel.text).toContain(editionNote(language, 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual([RENEW_EN]);
  });

  it('serves the en-US edition of a ja url asked for in en-US', async () => {
    const ja = canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, 'ja'));

    for (const channel of await everyChannel({ url: ja, language: 'en-US' })) {
      expect(channel.url).toBe(RENEW_EN);
      expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions.en.title);
      expect(channel.text).not.toContain('Jamf does not publish');
    }
  });

  it('labels the en edition a /ja/ url is answered with by its own address, and says so', async () => {
    const asked = `${SUPPORT.baseUrl}/ja/articles/11730439-jamf-connect-login-jc-l-via-intune-causes-black-screen`;

    for (const channel of await everyChannel({ url: asked })) {
      expect(channel.url).toBe(JC_LOGIN_EN);
      expect(channel.title).toBe(JC_LOGIN_BLACK_SCREEN.editions.en.title);
      expect(channel.text).toContain(editionNote('ja-JP', 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    for (const channel of await everyChannel({ url: asked, language: 'en-US' })) {
      expect(channel.url).toBe(JC_LOGIN_EN);
      expect(channel.text).not.toContain('Jamf does not publish');
    }
  });

  it('is unchanged without a language, or in the url\'s own', async () => {
    for (const args of [{ url: RENEW_EN }, { url: RENEW_EN, language: 'en-US' }]) {
      for (const channel of await everyChannel(args)) {
        expect(channel.url).toBe(RENEW_EN);
        expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions.en.title);
        expect(channel.text).not.toContain('*Note:');
        // New beside the unchanged reply: which edition it is.
        expect(channel.contentLocale).toBe('en-US');
      }
    }
    expect(requests).toEqual([RENEW_EN]);
  });

  // The site answers any slug, or none, after an article's id with the
  // edition the locale code names (2026-09-28).
  it.each([
    ['with no slug', `${SUPPORT.baseUrl}/en/articles/11016634`],
    ['with a slug the article no longer has', `${SUPPORT.baseUrl}/en/articles/11016634-renew-your-push-certificate`],
  ])('asks once for a url of the page\'s own edition %s, and labels it with the page\'s own address', async (_label, asked) => {
    for (const args of [{ url: asked }, { url: asked, language: 'en-US' }]) {
      for (const channel of await everyChannel(args)) {
        expect(channel.url).toBe(RENEW_EN);
        expect(channel.text).not.toContain('*Note:');
      }
    }
    expect(requests).toEqual([asked]);
  });

  it('keeps a url\'s fragment on the page it names, and leaves it off another edition', async () => {
    // A heading's id in the en edition; the ja edition's headings have others.
    const fragment = `${RENEW_EN}#h_b35069b35c`;

    for (const channel of await everyChannel({ url: fragment })) {
      expect(channel.url).toBe(fragment);
    }
    for (const channel of await everyChannel({ url: fragment, language: 'ja-JP' })) {
      expect(channel.url).toBe(RENEW_JA);
    }
  });

  describe('on a page that does not list its editions', () => {
    /** support.jamf.com routes nl, but publishes nothing in it (2026-09-28). */
    const DUTCH = `${SUPPORT.baseUrl}/nl/articles/11016634`;

    beforeEach(() => {
      const { title, blocks, breadcrumbs } = RENEW_PUSH_CERTIFICATE.editions.en;
      for (const url of [RENEW_EN, DUTCH]) {
        upstream.pages.set(url, nextDataPage({ articleContent: { title, blocks }, breadcrumbs }));
      }
    });

    it.each([
      ['ja-JP', RENEW_EN],
      // Neither the language nor the url's first segment is a code the site is read in.
      ['th-TH', DUTCH],
    ])('says %s was not applied to %s', async (language, url) => {
      for (const channel of await everyChannel({ url, language })) {
        expect(channel.url).toBe(url);
        expect(channel.text).toContain(
          `Language "${language}" was not applied: the page does not list its editions, so the page was served as the url names it.`,
        );
        expect(channel.contentLocale).toBeUndefined();
      }
      expect(requests).toEqual([url]);
    });

    it('says nothing without a language, or in the url\'s own, as on concepts.jamf.com', async () => {
      for (const args of [{ url: RENEW_EN }, { url: RENEW_EN, language: 'en-US' }]) {
        for (const channel of await everyChannel(args)) {
          expect(channel.url).toBe(RENEW_EN);
          expect(channel.text).not.toContain('*Note:');
        }
      }
      expect(requests).toEqual([RENEW_EN]);
    });
  });

  it('asks for neither page again while both are cached', async () => {
    await getArticle({ url: RENEW_EN, language: 'ja-JP' });
    const first = requests.length;
    await getArticle({ url: RENEW_EN, language: 'ja-JP' });

    expect(requests.length).toBe(first);
  });

  // Neither happens live: each of the 21 translated articles' pages lists
  // editions that are there. But the edition's own page is what says which
  // edition it is, so a listed edition that is gone is not served as one.
  it.each([
    ['answers with the en edition', (): string => servedAt(RENEW_EN)],
    ['is a 404', (): string => { throw new HttpError(404, '', RENEW_JA); }],
  ])('serves the page asked for, with the note, when the edition the page lists %s', async (_label, answer) => {
    upstream.pages.set(RENEW_JA, answer);

    for (const channel of await everyChannel({ url: RENEW_EN, language: 'ja-JP' })) {
      expect(channel.url).toBe(RENEW_EN);
      expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions.en.title);
      expect(channel.text).toContain(editionNote('ja-JP', 'en-US'));
    }
  });
});

// ── An edition that cannot be read ─────────────────────────────────────────

describe('an edition that cannot be read, for another reason than a 404', () => {
  it.each(EDITION_FAILURES)('serves the concepts.jamf.com page asked for in its place on %s, and says so', async (_label, failure, why) => {
    const ja = conceptsUrl('ja', AI_GOVERNANCE);
    upstream.pages.set(ja, failure(ja));

    for (const channel of await everyChannel({ url: AI_GOVERNANCE_EN, language: 'ja-JP' })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).toContain(unreadNote('ja-JP', why, 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    // A failure is not cached, so the second call asks for the edition again.
    expect(requests).toEqual([ja, AI_GOVERNANCE_EN, ja]);
  });

  it.each([
    ...EDITION_FAILURES,
    ['a page that carries neither an article nor a collection', () => () => nextDataPage({}), 'its page could not be parsed'],
  ] as const)('serves the support.jamf.com page asked for in its place on %s, already read, and says so', async (_label, failure, why) => {
    upstream.pages.set(RENEW_JA, failure(RENEW_JA));

    for (const channel of await everyChannel({ url: RENEW_EN, language: 'ja-JP' })) {
      expect(channel.url).toBe(RENEW_EN);
      expect(channel.title).toBe(RENEW_PUSH_CERTIFICATE.editions.en.title);
      expect(channel.text).toContain(unreadNote('ja-JP', why, 'en-US'));
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual([RENEW_EN, RENEW_JA, RENEW_JA]);
  });

  it('still fails the call when the page asked for fails as well', async () => {
    for (const url of [conceptsUrl('ja', AI_GOVERNANCE), AI_GOVERNANCE_EN]) {
      upstream.pages.set(url, () => { throw new HttpError(503, 'Service Unavailable', url); });
    }
    const result = await getArticle({ url: AI_GOVERNANCE_EN, language: 'ja-JP' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`HTTP 503 Service Unavailable: ${AI_GOVERNANCE_EN}`);
  });
});

// ── Both, with other arguments ─────────────────────────────────────────────

describe('`language` on a static url, beside the other arguments', () => {
  it('puts its note after the one about an ignored mapId + contentId pair', async () => {
    const result = await getArticle({
      url: JC_LOGIN_EN, language: 'ja-JP', mapId: 'someMap', contentId: 'someContent',
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(textOf(result)).toContain(
      '*Note: mapId and contentId were ignored: they address learn.jamf.com (Fluid Topics) topics, and a ' +
      `support.jamf.com url is fetched by url alone. ${editionNote('ja-JP', 'en-US')}*`,
    );
  });

  it('serves each url of a batch in the language asked for, or says why not', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_batch_get_articles',
      arguments: { urls: [AI_GOVERNANCE_EN, RENEW_EN, JC_LOGIN_EN], language: 'ja-JP', responseFormat: 'json' },
    }) as CallResult;

    expect(result.isError, textOf(result)).not.toBe(true);
    const { results } = result.structuredContent as { results: { url: string; title: string; content: string }[] };
    expect(results.map(r => r.url)).toEqual([
      conceptsUrl('ja', AI_GOVERNANCE),
      canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, 'ja')),
      JC_LOGIN_EN,
    ]);
    expect(results[0]?.content).toContain(aiGovernanceBody('ja'));
    expect(results[1]?.title).toBe(RENEW_PUSH_CERTIFICATE.editions.ja.title);
    expect(results[2]?.content).toContain(editionNote('ja-JP', 'en-US'));
  });
});
