/**
 * Table of contents for a static documentation source, built from its sitemap.
 *
 * A Fluid Topics publication ships a real TOC endpoint. A static site does
 * not — but concepts.jamf.com publishes a sitemap whose paths already encode
 * the hierarchy (`{locale}/guides/{category}/{article}`), so the tree can be
 * derived from 990 URLs in one request instead of crawling 99 pages per
 * locale and parsing each one's navigation.
 */

import { cacheKey } from './cache-key.js';
import { paginateTocEntries } from './toc-helpers.js';
import { canonicalStaticUrl, type StaticDocSource, type StaticSection } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocOptions, FetchTocResult, TocEntry } from '../types.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';

/** One `<url>` of a sitemap, reduced to what a TOC needs. */
export interface SitemapEntry {
  /** Absolute URL, in the spelling the source serves. See {@link canonicalStaticUrl}. */
  url: string;
  /**
   * Path segments after the origin, e.g. `['en', 'guides', 'ai-governance']`,
   * spelled as `URL.pathname` spells them: a non-ASCII character is
   * percent-encoded. {@link titleFromSlug} decodes one for display.
   */
  segments: string[];
  /** `<lastmod>`, when present. */
  lastModified?: string;
}

/**
 * Extract every `<loc>` from a sitemap, with its `<lastmod>` when it has one.
 *
 * Deliberately a scan for `<url>` blocks rather than an XML parse: the
 * document is a flat list, cheerio would have to be told to treat it as XML,
 * and a sitemap that fails to parse should still yield the entries it does
 * have.
 *
 * Takes the source because a `<loc>` is not a page's canonical spelling: both
 * sitemaps list every page without a trailing slash, and only one of the two
 * sites serves that form.
 */
export function parseSitemap(source: StaticDocSource, xml: string): SitemapEntry[];
/**
 * The form this took until #338. Each `<loc>` is canonicalised by the source
 * its own host names, as the one-argument {@link canonicalStaticUrl} does.
 *
 * @deprecated Pass the source: `parseSitemap(source, xml)`.
 */
export function parseSitemap(xml: string): SitemapEntry[];
export function parseSitemap(sourceOrXml: StaticDocSource | string, maybeXml?: string): SitemapEntry[] {
  const source = typeof sourceOrXml === 'string' ? undefined : sourceOrXml;
  const xml = typeof sourceOrXml === 'string' ? sourceOrXml : maybeXml ?? '';
  const out: SitemapEntry[] = [];
  for (const block of xml.match(/<url\b[\s\S]*?<\/url>/g) ?? []) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block)?.[1];
    if (loc === undefined) { continue; }
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block)?.[1];
    let segments: string[];
    try {
      segments = new URL(loc).pathname.split('/').filter(Boolean);
    } catch {
      continue;
    }
    out.push({
      url: source === undefined ? canonicalStaticUrl(loc) : canonicalStaticUrl(source, loc),
      segments,
      ...(lastmod !== undefined ? { lastModified: lastmod } : {}),
    });
  }
  return out;
}

/** Fetch and cache a source's sitemap. */
export async function loadSitemap(
  ctx: ServerContext,
  source: StaticDocSource,
): Promise<SitemapEntry[]> {
  const key = cacheKey('static-sitemap', { source: source.id });
  const cached = await ctx.cache.get<SitemapEntry[]>(key);
  if (cached !== null) { return cached; }

  const xml = await ctx.http.getText(`${source.baseUrl}/sitemap.xml`);
  const entries = parseSitemap(source, xml);
  await ctx.cache.set(key, entries, ctx.config.cacheTtl.products);
  return entries;
}

/**
 * Terms whose casing a naive capitalise gets wrong. Keyed lowercase.
 *
 * The sitemap gives slugs, not titles, and a slug keeps a title's letters but
 * not their case. Word-by-word capitalisation produces "Ai Governance",
 * "Apns Certificate" and "Shared Ipads", which read as mistakes; this table is
 * how the sites spell those words in their own titles. Measured on 2026-09-28
 * over the titles {@link titleFromSlug} is checked against: a word is here
 * when those titles spell it other than as an ordinary word, capitalised or
 * in lower case. Two words whose pages' titles do not hold them, `dlp` and
 * `jnuc`, are spelled as those pages spell them.
 *
 * Only the case of a word is changed, never its letters or where it breaks:
 * a slug runs together some names the site writes as two words, and
 * `jamfplatform` is "JamfPlatform", not "Jamf Platform". Fuse ignores case,
 * so what a search matches, and how it ranks it, is the same as it was:
 * over 61,960 queries taken from the titles, in all eight locales, not one
 * hit or score moved (2026-09-28). Splitting the four such names, as the site
 * writes them, changed the hits or their order for 994 of 61,976.
 *
 * Where the titles disagree, most of them decide, and both times they spell
 * the word as Apple and Jamf do: FileVault (12 titles, "Filevault" in 1) and
 * APNs (9, "APNS" in 1). That "Filevault" is the one word a title had right
 * before this table held it, and has wrong now. A tie decides nothing, so
 * `ebooks` is not here: one title has "eBooks" and one "Ebooks", and an entry
 * would only trade a word that is right for one that is wrong. `pin` is: one
 * title has "PIN", and the other "pin", in lower case in a sentence-case
 * title, which "Pin" did not match either.
 *
 * The table applies to a slug in any language, except where a key is also an
 * ordinary word in the slug's own: see {@link ORDINARY_WORDS}. Left as they
 * are:
 *
 * - `it`, "IT", though 4 titles hold the pronoun and 3 the abbreviation: a
 *   slug cannot tell the two apart, and concepts.jamf.com names a section
 *   "IT Workflows" in every locale. Likewise `url` ("url" in 1 of 5) and
 *   `macos` ("MacOS" in 3 of 46), and `mac`, "Mac" in 16 and "MAC", the
 *   address, in 2.
 * - An identifier a title quotes from an error or a setting, such as
 *   `enableFirewall`, `ASDErrorDomain` or `jamf-auth`. 18 titles hold one.
 * - An ordinary word a title spells in capitals, in a name or a quote:
 *   "IntelliJ IDEA", "DRC INSIGHT", "NONE", "TRIAL", "GET", "JAMF".
 *
 * A Map, so that a slug word naming a property every object inherits is a
 * word like any other. Looked up on an object literal until 2026-09-28,
 * `constructor` came out as "function Object() { [native code] }" and
 * `__proto__` as "[object Object]"; no live slug holds either. Exported for
 * the unit tests, which check that each entry changes only its key's case.
 */
export const TITLE_CASE_TERMS: ReadonlyMap<string, string> = new Map(Object.entries({
  ai: 'AI', api: 'API', byod: 'BYOD', ddm: 'DDM', it: 'IT', mdm: 'MDM',
  pki: 'PKI', ldap: 'LDAP', scep: 'SCEP', ztna: 'ZTNA', sso: 'SSO',
  vpn: 'VPN', mfa: 'MFA', dns: 'DNS', ip: 'IP', tls: 'TLS', url: 'URL',
  json: 'JSON', xml: 'XML', sdk: 'SDK', cli: 'CLI', ui: 'UI', ux: 'UX',
  id: 'ID', edr: 'EDR', xdr: 'XDR', siem: 'SIEM', saas: 'SaaS',
  macos: 'macOS', ios: 'iOS', ipados: 'iPadOS', tvos: 'tvOS',
  watchos: 'watchOS', visionos: 'visionOS', jamf: 'Jamf', apple: 'Apple',
  aws: 'AWS', okta: 'Okta', entra: 'Entra', jss: 'JSS',
  // Abbreviations, and terms spelled with one.
  '2fa': '2FA', ade: 'ADE', adfs: 'ADFS', apns: 'APNs', ard: 'ARD', asm: 'ASM',
  b2b: 'B2B', cpu: 'CPU', dlp: 'DLP', dmg: 'DMG', dnsproxy: 'DNSProxy',
  drc: 'DRC', faq: 'FAQ', fido: 'FIDO', gsx: 'GSX', gui: 'GUI', http: 'HTTP',
  idp: 'IdP', imei: 'IMEI', jc: 'JC', jcds: 'JCDS', jnuc: 'JNUC', jwt: 'JWT',
  laps: 'LAPS', llm: 'LLM', mcp: 'MCP', md5: 'MD5', mime: 'MIME', ms: 'MS',
  mut: 'MUT', nvram: 'NVRAM', oidc: 'OIDC', oie: 'OIE', os: 'OS', pin: 'PIN',
  pkcs12: 'PKCS12', pkg: 'PKG', pppc: 'PPPC', pram: 'PRAM', psso: 'PSSO',
  qr: 'QR', ropg: 'ROPG', saml: 'SAML', slasa: 'SLASA', smb: 'SMB', sms: 'SMS',
  smtp: 'SMTP', soc: 'SOC', ssh: 'SSH', ssl: 'SSL', tv: 'TV', uem: 'UEM',
  vpp: 'VPP', wifi: 'WiFi',
  // Plurals, which a word's own entry does not cover.
  ips: 'IPs', pdfs: 'PDFs', tvs: 'TVs', vpns: 'VPNs',
  // Apple's names.
  airplay: 'AirPlay', airprint: 'AirPrint', airtag: 'AirTag',
  appstore: 'AppStore', facetime: 'FaceTime',
  filevault: 'FileVault', filevault2: 'FileVault2', icloud: 'iCloud',
  imessage: 'iMessage', ipad: 'iPad', ipads: 'iPads', iphone: 'iPhone',
  iphones: 'iPhones', itunes: 'iTunes', macbooks: 'MacBooks',
  // Jamf's, the Jamf Concepts tools' among them.
  authchanger: 'authchanger', jamfautoupdate: 'JamfAutoUpdate',
  jamfcheck: 'JamfCheck', jamformer: 'jamformer', jamfplatform: 'JamfPlatform',
  jamfpro: 'JamfPro', jamfprotect: 'JamfProtect', jawa: 'JAWA',
  postinstall: 'PostInstall', prestage: 'PreStage', quickadd: 'QuickAdd',
  rapidid: 'RapidID', reenroller: 'ReEnroller', remediasoar: 'RemediaSOAR',
  saastenancy: 'SaaSTenancy',
  // Other vendors'.
  chromeos: 'ChromeOS', clearpass: 'ClearPass', forticlient: 'FortiClient',
  github: 'GitHub', godaddy: 'GoDaddy', goguardian: 'GoGuardian',
  iboss: 'iBoss', imazing: 'iMazing', jetbrains: 'JetBrains',
  launchdarkly: 'LaunchDarkly', n8n: 'n8n', openclaw: 'OpenClaw',
  sentinelone: 'SentinelOne', youtube: 'YouTube',
}));

/**
 * Keys of {@link TITLE_CASE_TERMS} that are also an ordinary word in a
 * language, by the locale code a slug in that language is listed under. A
 * slug in it is cased as if the table did not hold them, so a Spanish "os
 * recomendamos" is not "OS Recomendamos".
 *
 * support.jamf.com is the one source whose slugs are in their locale's own
 * language (concepts.jamf.com's are the en ones in every locale; see
 * `StaticDocSource.slugLocale`), and besides en it writes de, es and fr slugs
 * in Latin letters. Its ja and zh-TW slugs hold only English words in them,
 * such as `jamf-pro-apns-續約時顯示-403-存取被拒絕`, and get the whole table.
 * No de, es or fr slug holds a word listed here (2026-09-28), so nothing
 * shows that it is only ever the term in that language, and it is not
 * applied there. `id` is a Spanish word too, and is applied: the one es
 * title that holds it means the term ("Asocie su Jamf ID").
 *
 * In en, every title holding one of these means the term: OS in 6, LAPS 3,
 * MUT 2, PIN 2, and ADE, GUI, MIME, OIE and SOC 1 each, and each AI is
 * concepts.jamf.com's. So `pin`, `laps` and `mime`, English words as well,
 * are applied in en, as `pram` (1) is. `it` is the one key applied where it
 * is not only ever the term; {@link TITLE_CASE_TERMS} says why.
 *
 * Exported for the unit tests, which check that each is a key of the table.
 */
export const ORDINARY_WORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // ade "adieu", Mime "actor", Mut "courage", Pin "badge".
  ['de', new Set(['ade', 'mime', 'mut', 'pin'])],
  // os "you", pin "badge".
  ['es', new Set(['os', 'pin'])],
  // ai "have" (j'ai), gui "mistletoe", laps "lapse", mime, oie "goose",
  // os "bone", pin "pine", soc "ploughshare".
  ['fr', new Set(['ai', 'gui', 'laps', 'mime', 'oie', 'os', 'pin', 'soc'])],
]);

/** Words that stay lowercase unless they open the title. */
const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or',
  'the', 'to', 'via', 'with',
]);

/**
 * Characters a title must not carry, though a slug can spell any of them as
 * an escape: the controls, of which a newline would end the Markdown list
 * item a title is written into; the line and paragraph separators; and the
 * bidi marks, embeddings, overrides and isolates, which reorder the text
 * around them when it is displayed.
 */
const UNSAFE_IN_TITLE = /[\p{Cc}\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/**
 * A path segment with its percent-escapes decoded, where they decode.
 *
 * Decoded one run of escapes at a time, and a run that will not decode is
 * kept as written: `decodeURIComponent` throws on an escape that is not
 * UTF-8, and one bad escape must not cost a sitemap its index. Neither live
 * sitemap holds such an escape: every one of their 1,906 `<loc>`s decodes
 * (2026-09-26). The escapes of one character always stand side by side, so a
 * slug that would decode whole decodes to the same text run by run.
 *
 * A character in {@link UNSAFE_IN_TITLE} is written as its escape, as it was
 * before slugs were decoded.
 */
function decodeSlug(slug: string): string {
  return slug
    .replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
      try { return decodeURIComponent(run); } catch { return run; }
    })
    .replace(UNSAFE_IN_TITLE, char => encodeURIComponent(char));
}

const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * A letter of a script other than Latin: kana, a CJK ideograph, and so on.
 * A letter of the Common script, which belongs to no one script, does not
 * count: `µ` in `10µs` does not make that a mixed word. (`ー`, the kana
 * length mark, is Common too, and stands beside kana, which count.)
 */
const NON_LATIN_LETTER = /(?![\p{Script=Latin}\p{Script=Common}])\p{L}/u;

/**
 * One run of Latin letters and digits, inside a word that also holds others.
 * A run keeps its digits, as a word does, so it is cased as the same letters
 * and digits would be on their own: `2faで` is `2FAで`, as `2fa` is `2FA`.
 */
const LATIN_RUN = /[\p{Script=Latin}\p{N}]+/gu;

/** Whether a word mixes Latin letters with another script's, as `accountでjamf` does. */
function mixesScripts(word: string): boolean {
  return LATIN_LETTER.test(word) && NON_LATIN_LETTER.test(word);
}

/**
 * One word of a heading, cased; `opensTitle` exempts it from the minor-word
 * rule, and `ordinary` names the keys of {@link TITLE_CASE_TERMS} to pass over.
 */
function titleCaseWord(word: string, opensTitle: boolean, ordinary: ReadonlySet<string> | undefined): string {
  const lower = word.toLowerCase();
  const known = ordinary?.has(lower) === true ? undefined : TITLE_CASE_TERMS.get(lower);
  if (known !== undefined) { return known; }
  if (!opensTitle && TITLE_MINOR_WORDS.has(lower)) { return lower; }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turn a slug into a heading: `ai-governance` → `AI Governance`.
 *
 * Checked on 2026-09-28 against the real title of each page it names that has
 * one to check: all 894 support.jamf.com articles, in all six locales, as
 * Intercom's collection pages give them, and concepts.jamf.com's 93 en pages,
 * as each page gives its own. (concepts.jamf.com's other locales use the en
 * slugs, and translate the titles.) 929 of those 987 titles keep their
 * letters and digits in the slug, in order, and 446 of the 929 come out
 * exactly as the page has them but for punctuation and spacing. Of the other
 * 483, 444 differ only in style: support.jamf.com writes most of its titles
 * in sentence case ("How to determine if an IdP is configured…"), and a few
 * with every word capitalised ("…Via The Jamf Pro Portal"), where this
 * writes title case. The last 39 hold a word the site spells two ways, or one
 * {@link TITLE_CASE_TERMS} leaves alone; its comment says which. The 58 that
 * lost letters lost them to the slug: an accent (`für` is `fur`), or words
 * the title has and the slug does not.
 *
 * `slug` is a path segment as `URL.pathname` spells it, which percent-encodes
 * every character that is not ASCII, so it is decoded first. Until it was,
 * each of the 29 support.jamf.com articles with a Japanese or Chinese slug —
 * every ja and zh-TW article it lists, 2026-09-26 — was titled with its
 * escapes ("Jamf ID %E3%81%AE%E4%BD%9C%E6%88%90"), and no query in either
 * language could match one. A slug that is already decoded comes out the
 * same, unless it holds a `%` and two hex digits, which are read as an
 * escape, or a character {@link UNSAFE_IN_TITLE} names, which is escaped. An
 * escaped hyphen, `%2D`, is a hyphen, as RFC 3986 says it is, and so
 * separates words like any other.
 *
 * Japanese writes no space between words, and Intercom's slugs keep that, so
 * one hyphen-separated word can hold several: `accountでjamf`. Each Latin run
 * in such a word is cased as a word of its own, or it reads "Accountでjamf
 * Idを…" where the article says "AccountでJamf IDを…". Only the run that
 * opens the title is exempt from the minor-word rule. Any other word is cased
 * whole, exactly as before.
 *
 * Measured against the titles Intercom's collection pages give those 29
 * (2026-09-26): all 29 have the letters and digits of their real title, in
 * order, and 26 match it exactly but for punctuation and spacing (24 until
 * `apns` and `idp` were cased, 2026-09-28). The other three differ only in
 * case, which a slug loses and the rules here guess wrong: `Cer` for `.cer`,
 * and, in two quoted error messages, `Jamf Auth` for `jamf-auth` and "We Are
 * Sorry an Error Occurred" for "We are sorry, an error occurred".
 *
 * `language` is the locale code of the language `slug` is written in, such as
 * `es`, so that a word the table spells as a term is not, where it is an
 * ordinary word in that language: see {@link ORDINARY_WORDS}. Without it,
 * every entry applies.
 */
export function titleFromSlug(slug: string, language?: string): string {
  const ordinary = language === undefined ? undefined : ORDINARY_WORDS.get(language);
  const words = decodeSlug(slug).split('-').filter(Boolean);
  return words
    .map((word, index) => mixesScripts(word)
      ? word.replace(LATIN_RUN, (run: string, offset: number) =>
        titleCaseWord(run, index === 0 && offset === 0, ordinary))
      : titleCaseWord(word, index === 0, ordinary))
    .join(' ');
}

interface TreeNode {
  slug: string;
  url?: string;
  children: Map<string, TreeNode>;
}

/** @param language the locale code of the language the slugs are written in */
function toTocEntries(nodes: Iterable<TreeNode>, titles: Map<string, string>, language: string): TocEntry[] {
  return [...nodes]
    // By its words, not its escapes, which would sort every non-ASCII slug
    // ahead of every ASCII one.
    .sort((a, b) => decodeSlug(a.slug).localeCompare(decodeSlug(b.slug)))
    .map(node => {
      const children = toTocEntries(node.children.values(), titles, language);
      const entry: TocEntry = {
        title: titles.get(node.url ?? '') ?? titleFromSlug(node.slug, language),
        url: node.url ?? '',
      };
      if (children.length > 0) { entry.children = children; }
      return entry;
    });
}

/**
 * Build a TOC for one section of a static source, in one locale.
 *
 * @param locale the source's own locale code, e.g. `en` — not `en-US`
 */
export async function buildStaticToc(
  ctx: ServerContext,
  source: StaticDocSource,
  section: StaticSection,
  locale: string,
): Promise<TocEntry[]> {
  const entries = await loadSitemap(ctx, source);
  const root = new Map<string, TreeNode>();

  for (const entry of entries) {
    const [entryLocale, entrySection, ...rest] = entry.segments;
    if (entryLocale !== locale || entrySection !== section.path) { continue; }
    // The section's own index page is the container, not a child of itself.
    if (rest.length === 0) { continue; }

    let level = root;
    let node: TreeNode | undefined;
    for (const slug of rest) {
      node = level.get(slug);
      if (node === undefined) {
        node = { slug, children: new Map() };
        level.set(slug, node);
      }
      level = node.children;
    }
    if (node !== undefined) { node.url = entry.url; }
  }

  return toTocEntries(root.values(), new Map(), source.slugLocale ?? locale);
}

/**
 * This server's locale id for one of `source`'s own codes: `ja-JP` for `ja`.
 *
 * Read back through the source's locale table, which names each code once
 * (see {@link StaticDocSource.locales}).
 * Undefined for a code the table does not name, such as concepts.jamf.com's
 * `ko`: no `language` value asks for it.
 */
function localeIdFor(source: StaticDocSource, sourceLocale: string): string | undefined {
  return Object.entries(source.locales).find(([, code]) => code === sourceLocale)?.[0];
}

/**
 * A `FetchTocResult` for a static source's section.
 *
 * Pagination and token truncation are the same operations the Fluid Topics
 * path performs, applied to entries that came from a sitemap instead of a
 * map: a caller paging through a Concepts TOC must not get a different shape
 * from one paging through Jamf Pro's.
 *
 * @param sourceLocale the source's own locale code, e.g. `ja`. The result's
 *   `resolvedLocale` is this server's id for it, e.g. `ja-JP`, or absent for
 *   a code the source's locale table does not name.
 */
export async function fetchStaticToc(
  ctx: ServerContext,
  source: StaticDocSource,
  section: StaticSection,
  sourceLocale: string,
  options: FetchTocOptions = {},
): Promise<FetchTocResult> {
  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  const allToc = await buildStaticToc(ctx, source, section, sourceLocale);
  const resolvedLocale = localeIdFor(source, sourceLocale);

  return {
    ...paginateTocEntries(allToc, page, maxTokens),
    // The locale that answered is the one asked for: unlike Fluid Topics,
    // where a family may exist in en-US only, a static section either
    // publishes the locale or `resolveTocSource` refused before reaching here.
    // Live, each of concepts.jamf.com's ten locale codes lists the same 99
    // pages (2026-09-28).
    //
    // Reported as this server's id, as every other path reports it, because
    // `get_toc` compares it with the `language` it was asked in. Until
    // 2026-09-28 this was the site's own code, so a request for a locale's
    // own edition said the opposite: "Jamf does not publish this document in
    // ja-JP. Showing the ja edition instead." Live, that was both sections
    // in en-US, ja-JP, de-DE, es-ES, fr-FR and nl-NL, the six locales whose
    // code the site spells differently; zh-TW and zh-CN were spared.
    ...(resolvedLocale !== undefined ? { resolvedLocale } : {}),
  };
}
