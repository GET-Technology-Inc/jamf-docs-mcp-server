/**
 * concepts.jamf.com and support.jamf.com as they address a page's editions,
 * measured live on 2026-09-28, for suites that drive `jamf_docs_get_article`
 * and `jamf_docs_batch_get_articles` over MCP with only the http client
 * stubbed.
 *
 * - concepts.jamf.com puts an edition under its locale code: the sitemap lists
 *   the same 99 paths under each of its ten codes, and `/ja/guides/ai-governance/`
 *   is the Japanese edition of `/en/guides/ai-governance/`. A code it does not
 *   publish in (`th`, `it`, `pt-BR`) is a 404, and so is a path it does not
 *   have. `/guides/ai-governance/`, with no code, answers 200 too.
 * - support.jamf.com keeps an article's or a collection's Intercom id in every
 *   locale, and each page lists its editions in `localeLinks`
 *   (fixtures/support-editions.ts). `/<code>/articles/<id>-<any slug>` is a
 *   301 to the locale's edition where it has one, and to the en edition where
 *   it does not; the stub serves the page that redirect ends at, as a request
 *   that follows redirects gets it.
 */

import { HttpError, type HttpClient } from '../../src/core/http-client.js';
import { STATIC_DOC_SOURCES } from '../../src/core/constants/sources.js';
import {
  JC_LOGIN_BLACK_SCREEN,
  RENEW_PUSH_CERTIFICATE,
  SELF_SERVICE_PLUS,
  type ArticleEditionFixture,
  type CollectionEditionFixture,
  type SupportPageFixture,
} from '../fixtures/support-editions.js';
import { nextDataPage } from './support-upstream.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

/** The codes concepts.jamf.com's sitemap lists every page under (2026-09-28). */
export const CONCEPTS_SITE_CODES = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'nl', 'pl', 'zh-CN', 'zh-TW'] as const;

/** The AI Governance guide's opening line in two of its editions, as served. */
export const AI_GOVERNANCE_BODY: Readonly<Record<string, string>> = {
  en: 'Practical guides for installing, configuring, and deploying Jamf Concepts tools in your environment.',
  ja: 'お使いの環境で Jamf Concepts ツールをインストール、構成、デプロイするための実践的なガイドです。',
};

/** The line the stub serves in an edition of AI Governance: the live one where captured. */
export function aiGovernanceBody(code: string): string {
  return AI_GOVERNANCE_BODY[code] ?? `The ${code} edition of the AI Governance guide.`;
}

/** A concepts.jamf.com page, in its locale code `code`. */
export function conceptsUrl(code: string, path: string): string {
  return `${CONCEPTS.baseUrl}/${code}/${path}/`;
}

/** A page this stub serves in en and in no other locale, as no live one is. */
export const ENGLISH_ONLY_PATH = 'guides/english-only';

function conceptsPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title} | Jamf Concepts</title>` +
    `<meta property="og:title" content="${title}"></head><body>` +
    '<header><nav><a href="/en/guides/">Guides</a></nav></header>' +
    `<main class="flex-1"><article class="prose"><p>${body}</p></article></main>` +
    '</body></html>';
}

function concepts(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const path = segments.join('/');
  if (path === 'guides/ai-governance') {
    return conceptsPage('AI Governance', 'The unprefixed page.');
  }
  const [code = '', ...rest] = segments;
  const tail = rest.join('/');
  if ((CONCEPTS_SITE_CODES as readonly string[]).includes(code)) {
    if (tail === 'guides/ai-governance') { return conceptsPage('AI Governance', aiGovernanceBody(code)); }
    if (tail === ENGLISH_ONLY_PATH && code === 'en') { return conceptsPage('English Only', 'Published in English only.'); }
  }
  throw new HttpError(404, '', `${CONCEPTS.baseUrl}${pathname}`);
}

// ── support.jamf.com ────────────────────────────────────────────────────────

/** An edition's address as its page's `localeLinks` spells it: raw. */
export function editionUrl(page: SupportPageFixture<unknown>, code: string): string {
  const link = page.localeLinks.find(l => l.id === code);
  if (link === undefined) { throw new Error(`no ${code} in localeLinks`); }
  return link.absoluteUrl;
}

/** The Intercom id in a page's address. */
function intercomId(page: SupportPageFixture<unknown>): string {
  return /\/(?:articles|collections)\/(\d+)/.exec(page.localeLinks[0]?.absoluteUrl ?? '')?.[1] ?? '';
}

const ARTICLES: readonly SupportPageFixture<ArticleEditionFixture>[] = [RENEW_PUSH_CERTIFICATE, JC_LOGIN_BLACK_SCREEN];
const COLLECTIONS: readonly SupportPageFixture<CollectionEditionFixture>[] = [SELF_SERVICE_PLUS];

function localeLinks(page: SupportPageFixture<unknown>, code: string): unknown[] {
  return page.localeLinks.map(link => ({ ...link, hreflang: link.id, selected: link.id === code }));
}

function articlePage(page: SupportPageFixture<ArticleEditionFixture>, code: string): string {
  const edition = page.editions[code];
  return nextDataPage({
    articleContent: { title: edition.title, blocks: edition.blocks, markdown: null },
    breadcrumbs: edition.breadcrumbs,
    localeLinks: localeLinks(page, code),
    intl: { locale: code },
  });
}

function collectionPage(page: SupportPageFixture<CollectionEditionFixture>, code: string): string {
  const edition = page.editions[code];
  return nextDataPage({
    collection: {
      id: intercomId(page),
      name: edition.name,
      description: edition.description,
      articleSummaries: edition.articleSummaries,
      subcollections: [],
      url: editionUrl(page, code),
    },
    breadcrumbs: edition.breadcrumbs,
    localeLinks: localeLinks(page, code),
    intl: { locale: code },
  });
}

/**
 * A support.jamf.com page by its locale code and Intercom id, whatever its
 * slug: that locale's edition where it has one, else the en edition.
 */
function support(pathname: string): string {
  const match = /^\/([^/]+)\/(articles|collections)\/(\d+)/.exec(decodeURIComponent(pathname));
  if (match !== null) {
    const [, code = '', kind, id] = match;
    const pages: readonly SupportPageFixture<unknown>[] = kind === 'articles' ? ARTICLES : COLLECTIONS;
    const page = pages.find(p => intercomId(p) === id);
    if (page !== undefined) {
      const served = code in page.editions ? code : 'en';
      return kind === 'articles'
        ? articlePage(page as SupportPageFixture<ArticleEditionFixture>, served)
        : collectionPage(page as SupportPageFixture<CollectionEditionFixture>, served);
    }
  }
  throw new HttpError(404, '', `${SUPPORT.baseUrl}${pathname}`);
}

/** What either site answers `url` with, as modelled above; throws what it fails with. */
export function servedAt(url: string): string {
  const { hostname, pathname } = new URL(url);
  if (hostname === CONCEPTS.hostname) { return concepts(pathname); }
  if (hostname === SUPPORT.hostname) { return support(pathname); }
  throw new Error(`unexpected request: ${url}`);
}

export interface StaticEditionsUpstream {
  http: HttpClient;
  /** Every url requested, in order. */
  requests: string[];
  /**
   * Pages served in place of the ones above, by url as requested: the page,
   * or a function that returns it or throws what the request fails with.
   */
  pages: Map<string, string | (() => string)>;
  reset: () => void;
}

export function createStaticEditionsUpstream(): StaticEditionsUpstream {
  const requests: string[] = [];
  const pages = new Map<string, string | (() => string)>();
  const http: HttpClient = {
    getText: async (url) => {
      requests.push(url);
      const override = pages.get(url);
      if (typeof override === 'function') { return await Promise.resolve(override()); }
      return await Promise.resolve(override ?? servedAt(url));
    },
    getJson: async (url) => await Promise.reject(new Error(`unexpected request: ${url}`)),
    postJson: async (url) => await Promise.reject(new Error(`unexpected request: ${url}`)),
  };
  return {
    http,
    requests,
    pages,
    reset: () => {
      requests.length = 0;
      pages.clear();
    },
  };
}
