/**
 * What `jamf_docs_get_toc` serves for a support.jamf.com collection in a
 * language the site does not publish at all: the registered tools over MCP,
 * with the real Intercom reader and cache keys, and only the http client
 * stubbed with the collections each locale's home page listed live on
 * 2026-09-28.
 *
 * The source's locale table names six locales. The other five `language`
 * values, th-TH, nl-NL, it-IT, pt-BR and zh-CN, have no edition of anything:
 * live on 2026-09-28, `/th/`, `/nl/`, `/it/`, `/pt/`, `/pt-BR/` and `/zh-CN/`
 * each answered 200 with a home page listing no collections.
 *
 * Until 2026-09-28 each of the five was an error, for every one of the 9 ids
 * `jamf_docs_list_products` gives: "Jamf Support Knowledge Base does not
 * publish in th-TH. Available: en-US, de-DE, es-ES, fr-FR, ja-JP, zh-TW."
 * Yet a locale the table names and whose listing lacks the collection, as
 * ja-JP lacks Jamf Now, gets the en-US edition with a `localeNote` (#352), and
 * so does a Fluid Topics publication with no map in the language, th-TH
 * included. So the five now read as a locale that lists nothing, which is
 * what their home pages say they are, without asking one for its listing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl, dynamicSectionId } from '../../../src/core/constants/sources.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants/locales.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  SUPPORT_COLLECTIONS_BY_LOCALE,
  type SupportCollectionFixture,
} from '../../fixtures/support-collections-by-locale.js';
import { HOME_FAILURES, collectionIn, createSupportUpstream, homeUrl, listedUrl } from '../../helpers/support-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

/** The locale ids `language` accepts that the source's locale table leaves out. */
const UNDECLARED = SUPPORTED_LOCALE_IDS.filter(id => !(id in SUPPORT.locales));

/** The en collections, which `list_products` builds its ids from. */
const ENGLISH: readonly SupportCollectionFixture[] = SUPPORT_COLLECTIONS_BY_LOCALE.en ?? [];

const JAMF_PRO = '12369024';

const upstream = createSupportUpstream();
const { requests } = upstream;

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http: upstream.http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  registerListProductsTool(server, ctx);

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

async function getToc(
  publication: string,
  language: string,
  responseFormat: 'json' | 'markdown' = 'json',
): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_get_toc',
    arguments: { publication, language, responseFormat },
  }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** The `localeNote` every path gives an en-US edition served to `language`. */
function englishEditionNote(language: string): string {
  return `Jamf does not publish this document in ${language}. Showing the en-US edition instead.`;
}

/** The page the en copy of a collection is read from. */
function englishCollectionUrl(id: string): string {
  return canonicalStaticUrl(SUPPORT, listedUrl('en', collectionIn('en', id)!));
}

describe('jamf_docs_get_toc: a support.jamf.com collection in a language the site does not publish', () => {
  it('is asked of the five language values the source\'s locale table leaves out', () => {
    expect([...UNDECLARED].sort()).toEqual(['it-IT', 'nl-NL', 'pt-BR', 'th-TH', 'zh-CN']);
  });

  it('is asked of every id jamf_docs_list_products gives', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    }) as CallResult;
    const listed = (result.structuredContent?.publications as { id: string }[])
      .map(p => p.id)
      .filter(id => id.startsWith('jamf-support-'));

    expect(listed).toEqual(ENGLISH.map(c => dynamicSectionId(SUPPORT, c.slug)));
  });

  const cases = UNDECLARED.flatMap(language =>
    ENGLISH.map(c => [dynamicSectionId(SUPPORT, c.slug), language, c] as const));

  it.each(cases)('serves %s in %s as its en-US edition, and says so', async (publication, language, collection) => {
    const json = await getToc(publication, language, 'json');
    const markdown = await getToc(publication, language, 'markdown');

    for (const result of [json, markdown]) {
      expect(result.isError, textOf(result)).not.toBe(true);
      expect((result.structuredContent?.entries as { url: string }[]).map(e => e.url))
        .toEqual([canonicalStaticUrl(SUPPORT, collection.first.url)]);
      expect(result.structuredContent?.product).toBe(`${SUPPORT.name}: ${collection.name}`);
      // The language to send back with the next page is the one asked in.
      expect(result.structuredContent?.language).toBe(language);
      expect(result.structuredContent?.publicationId).toBe(publication);
      expect(result.structuredContent?.localeNote).toBe(englishEditionNote(language));
    }
    expect((JSON.parse(textOf(json)) as Record<string, unknown>).localeNote).toBe(englishEditionNote(language));
    expect(textOf(markdown)).toContain(`> **Language Note:** ${englishEditionNote(language)}`);
  });

  it.each(UNDECLARED)('reads %s from the pages an en-US request reads, and asks nothing of its own home page', async (language) => {
    const asked = await getToc('jamf-support-jamf-pro', language);
    expect(asked.isError, textOf(asked)).not.toBe(true);
    expect(requests).toEqual([homeUrl('en'), englishCollectionUrl(JAMF_PRO)]);

    // Cached under the page it was read from, so en-US reads nothing more.
    requests.length = 0;
    const english = await getToc('jamf-support-jamf-pro', 'en-US');
    expect(english.structuredContent?.entries).toEqual(asked.structuredContent?.entries);
    expect(english.structuredContent?.localeNote).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it('offers list_products\' ids for an id no listing has, each marked as the en-US edition', async () => {
    const result = await getToc('jamf-support-jamf-pro-docs', 'th-TH');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Unknown Jamf Support Knowledge Base collection: "jamf-support-jamf-pro-docs".\n\n' +
      `Available in th-TH:\n${ENGLISH.map(c => `- \`${dynamicSectionId(SUPPORT, c.slug)}\` (en-US edition)`).join('\n')}`,
    );
  });

  it.each(HOME_FAILURES)('%s en home page: an error naming that page, as for a locale whose listing is empty', async (failure) => {
    upstream.failing.set('en', failure);

    const result = await getToc('jamf-support-jamf-pro', 'th-TH');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(homeUrl('en'));
    expect(textOf(result)).not.toContain('does not publish');
  });

  it.each(HOME_FAILURES)('%s en home page: asks for it again on the next call, and serves the en-US edition once it answers', async (failure) => {
    upstream.failing.set('en', failure);
    const down = await getToc('jamf-support-jamf-pro', 'th-TH');
    expect(down.isError).toBe(true);

    upstream.failing.clear();
    const recovered = await getToc('jamf-support-jamf-pro', 'th-TH');

    // Not failed again from a remembered failure, as `jamf_docs_list_products`
    // does for a minute: a call in any locale asks for the page it needs.
    expect(recovered.isError, textOf(recovered)).not.toBe(true);
    expect(recovered.structuredContent?.localeNote).toBe(englishEditionNote('th-TH'));
    expect(requests.filter(url => url === homeUrl('en'))).toHaveLength(2);
  });
});
