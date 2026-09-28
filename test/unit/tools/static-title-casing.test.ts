/**
 * How `jamf_docs_search` and `jamf_docs_get_toc` spell the product and
 * protocol terms in a title made from a slug: the registered tools over MCP,
 * with the real sitemap reader and only the http client stubbed, serving
 * paths and titles captured live on 2026-09-28.
 *
 * A slug keeps a title's letters but not their case, and the table that puts
 * the case back held 40 words. So `jamf_docs_search` listed "Apns Certificate
 * and Jamf Now" and "How to Determine If an Idp Is Configured to Use Ropg"
 * among its other-source matches, and `jamf_docs_get_toc` listed
 * concepts.jamf.com's tools as "Pppc Utility", "Jamfcheck" and "Jawa". Live,
 * 203 of the 987 titles that could be checked against the page's own held
 * such a word, and 347 of the 1,638 titles the two sources' indexes hold, in
 * the eight locales, now change.
 *
 * Since 2026-09-28 both tools title a page as the site lists it, and from its
 * slug only where that listing cannot be read (static-titles.ts;
 * static-listed-titles.test.ts). Nothing here serves a listing, so every
 * title is made from its slug.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { CONCEPTS_TITLES, SUPPORT_TITLES } from '../../fixtures/static-titles.js';

interface CallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

interface Hit { title: string; url: string; source: string }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

/**
 * Live concepts.jamf.com pages whose slug has words their title has not, or
 * in another order, so the fixture leaves them out: "GitHub Actions" is
 * "Form to Wipe — GitHub Actions Deployment", and `mcp-rapidid` is "RapidID
 * MCP Server". The site spells their terms, where the title or the page holds
 * them, as these are now titled.
 */
const MORE_CONCEPTS_PATHS = [
  'concepts/mcp-hub',
  'concepts/mcp-rapidid',
  'guides/device-trust-identity-and-deployment/platform-single-sign-on/jnuc-2025-sessions',
  'guides/device-trust-identity-and-deployment/platform-single-sign-on/psso-jamfpro-okta',
  'guides/it-workflows/form-to-wipe/github-actions',
  'guides/it-workflows/form-to-wipe/n8n',
  'guides/resource-access-control/securing-self-hosted-llm-access-with-trusted-egress-ips',
  'guides/threat-and-risk-management/data-loss-protection/dlp-deep-packet-inspection',
];

/** concepts.jamf.com lists the same paths in every locale; these are en's, in ja and fr too. */
const CONCEPTS_PATHS = [
  ...CONCEPTS_TITLES.map(t => t.listed.replace(/^\/en\//, '')),
  ...MORE_CONCEPTS_PATHS,
];

function sitemap(locs: string[]): string {
  return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

const http: HttpClient = {
  getText: async (url) => {
    if (url === `${SUPPORT.baseUrl}/sitemap.xml`) {
      return await Promise.resolve(sitemap(SUPPORT_TITLES.map(t => `${SUPPORT.baseUrl}${t.listed}`)));
    }
    if (url === `${CONCEPTS.baseUrl}/sitemap.xml`) {
      return await Promise.resolve(sitemap(['en', 'ja', 'fr'].flatMap(code => [
        `${CONCEPTS.baseUrl}/${code}/guides`,
        `${CONCEPTS.baseUrl}/${code}/concepts`,
        ...CONCEPTS_PATHS.map(path => `${CONCEPTS.baseUrl}/${code}/${path}`),
      ])));
    }
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({
    http,
    mapsRegistry: createStubMapsRegistry(),
    // One Fluid Topics hit, so a search reaches its normal reply.
    searchProvider: {
      search: async () => await Promise.resolve([{
        title: 'Renewing the APNs Certificate',
        snippet: 'APNs.',
        product: 'Jamf Pro',
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Renewing_the_APNs_Certificate',
      }]),
    },
  });
  server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  registerGetTocTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing the tools first makes the client check each `structuredContent`
  // against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return result;
}

/** The titles of the support.jamf.com matches `jamf_docs_search` reports. */
async function supportTitles(query: string, language: string): Promise<string[]> {
  const result = await call('jamf_docs_search', { query, language });
  return ((result.structuredContent?.otherSources ?? []) as Hit[])
    .filter(hit => hit.source === SUPPORT.name)
    .map(hit => hit.title);
}

/** Every title in a concepts.jamf.com section's TOC, over all its pages. */
async function tocTitles(publication: string, language: string): Promise<string[]> {
  const titles: string[] = [];
  for (let page = 1; ; page++) {
    const result = await call('jamf_docs_get_toc', { publication, language, page });
    titles.push(...(result.structuredContent?.entries as { title: string }[]).map(entry => entry.title));
    if (result.structuredContent?.hasMore !== true) { return titles; }
  }
}

describe('jamf_docs_search: the other-source matches', () => {
  it('spells APNs and IdP as the articles do', async () => {
    expect(await supportTitles('APNs Certificate and Jamf Now', 'en-US'))
      .toContain('APNs Certificate and Jamf Now');
    expect(await supportTitles('determine if an IdP is configured', 'en-US'))
      .toContain('How to Determine If an IdP Is Configured to Use ROPG');
  });

  it('spells Apple\'s and other vendors\' names as the articles do', async () => {
    expect(await supportTitles('Managing Shared iPads', 'en-US'))
      .toContain('Managing Shared iPads with Jamf School');
    expect(await supportTitles('FileVault Recovery Key', 'en-US'))
      .toContain('How to Reset Passwords with the FileVault Recovery Key in Jamf Pro');
    expect(await supportTitles('PreStage Enrollment Changes', 'en-US'))
      .toContain('PreStage Enrollment Changes Not Applying to Existing Devices');
    expect(await supportTitles('Install SentinelOne', 'en-US'))
      .toContain('How to Install SentinelOne with Jamf Now');
  });

  it('keeps a name the site writes in lower case in lower case, even opening the title', async () => {
    expect(await supportTitles('authchanger', 'en-US')).toContain('authchanger and Jamf Connect');
  });

  it('spells the terms in a Chinese title as the article does', async () => {
    expect(await supportTitles('IdP 憑證', 'zh-TW')).toContain('如果您的身份提供者 IdP 憑證無法登入 Jamf 帳戶');
    expect(await supportTitles('APNs 續約', 'zh-TW')).toContain('Jamf Pro APNs 續約時顯示 403 存取被拒絕');
  });

  it('writes the same titles into the Markdown reply', async () => {
    const result = await call('jamf_docs_search', { query: 'APNs Certificate and Jamf Now', language: 'en-US' });
    const page = SUPPORT_TITLES.find(t => t.title === 'APNs Certificate and Jamf Now');

    expect(page).toBeDefined();
    const url = canonicalStaticUrl(SUPPORT, `${SUPPORT.baseUrl}${page?.listed ?? ''}`);
    expect(result.content[0].text).toContain(`[APNs Certificate and Jamf Now](${url})`);
    expect(result.content[0].text).not.toContain('Apns');
  });

  it('does not serve a title index cached with the old casing', async () => {
    // What a build before this one left behind, under the key it used. The
    // index's entries hold titles and are kept for `cacheTtl.products`, 7
    // days by default, so without a new namespace an upgrade would go on
    // showing these.
    const stale = SUPPORT_TITLES
      .filter(t => t.listed.startsWith('/en/'))
      .map(t => ({
        title: t.title === 'APNs Certificate and Jamf Now' ? 'Apns Certificate and Jamf Now' : t.title,
        url: canonicalStaticUrl(SUPPORT, `${SUPPORT.baseUrl}${t.listed}`),
        source: SUPPORT.name,
      }));
    await ctx.cache.set('static-search-index-v3:{"locale":"en","source":"jamf-support"}' as CacheKey, stale);

    const titles = await supportTitles('APNs Certificate and Jamf Now', 'en-US');

    expect(titles).toContain('APNs Certificate and Jamf Now');
    expect(titles).not.toContain('Apns Certificate and Jamf Now');
  });
});

describe('jamf_docs_get_toc: concepts.jamf.com', () => {
  // fr-FR too, whose slugs are the en ones: `ai` is a French word, and still
  // "AI" in "AI Governance".
  it.each(['en-US', 'ja-JP', 'fr-FR'])('spells the open-source tools as the site does, in %s', async (language) => {
    const titles = await tocTitles('jamf-concepts-tools', language);

    expect(titles).toEqual(expect.arrayContaining([
      'JAWA', 'JamfCheck', 'PPPC Utility', 'PSSO Utility', 'ReEnroller', 'RemediaSOAR',
      'SaaSTenancy', 'jamformer', 'MCP Hub', 'MCP RapidID', 'JamfPlatform Go SDK',
      'Terraform Provider JamfAutoUpdate',
      // Already right, and still.
      'DDM Explorer', 'Jamf CLI',
    ]));
  });

  it.each(['en-US', 'ja-JP', 'fr-FR'])('spells the terms in the guides as the site does, in %s', async (language) => {
    const titles = await tocTitles('jamf-concepts-guides', language);

    expect(titles).toEqual(expect.arrayContaining([
      'Adopting Terraform for Jamf with jamformer',
      'Detecting Blocking Remediating OpenClaw Using Jamf',
      'DLP Deep Packet Inspection',
      'GitHub Actions',
      'JNUC 2025 Sessions',
      'PSSO JamfPro Okta',
      'Securing Self Hosted LLM Access with Trusted Egress IPs',
      'n8n',
      // Already right, and still.
      'AI Governance', 'BYOD', 'IT Workflows', 'Platform SSO for macOS',
      'SaaS Tenancy Control', 'SIEM XDR Integration',
    ]));
  });
});
