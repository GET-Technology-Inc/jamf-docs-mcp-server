import { describe, it, expect } from 'vitest';
import { cacheKey, CACHE_NAMESPACES } from '../../../src/core/services/cache-key.js';
import { buildSearchCacheKey } from '../../../src/core/services/search-service.js';

describe('cacheKey', () => {
  it('no namespace contains the delimiter', () => {
    expect(CACHE_NAMESPACES.filter(n => n.includes(':'))).toEqual([]);
  });

  it('is readable', () => {
    expect(cacheKey('ft-toc', { locale: 'en-US', product: 'jamf-pro', version: '11.5' }))
      .toBe('ft-toc:{"locale":"en-US","product":"jamf-pro","version":"11.5"}');
    expect(cacheKey('maps-registry')).toBe('maps-registry');
  });

  it('no value can forge a neighbouring key', () => {
    const a = cacheKey('ft-toc', { locale: 'en-US', product: 'jamf-pro', version: '11.5' });
    const b = cacheKey('ft-toc', { locale: 'en-US', product: 'jamf-pro', version: '11.5","product":"jamf-school' });
    expect(a).not.toBe(b);
  });

  it('is insensitive to part order', () => {
    expect(cacheKey('ft-toc', { locale: 'en-US', product: 'jamf-pro', version: 'current' }))
      .toBe(cacheKey('ft-toc', { version: 'current', product: 'jamf-pro', locale: 'en-US' }));
  });

  // Totality, not injectivity: a key that omits something the value depends on
  // is silently wrong rather than merely collidable. These were keyed on
  // `{ locale }` alone while the content is fetched per `mapId`, so two maps'
  // glossaries overwrote each other. `locale` is gone from the space in the
  // same breath — it never reached the fetch, and an FT mapId already is
  // locale-specific, so declaring it asserted a determinant that is not one.
  it('distinguishes glossary entries from different maps', () => {
    expect(cacheKey('glossary-toc', { mapId: 'mapA' }))
      .not.toBe(cacheKey('glossary-toc', { mapId: 'mapB' }));
    expect(cacheKey('glossary-content', { mapId: 'mapA', contentId: 'c1' }))
      .not.toBe(cacheKey('glossary-content', { mapId: 'mapB', contentId: 'c1' }));
  });

  it('gives a single-entry cache the bare namespace as its key', () => {
    expect(cacheKey('maps-registry')).toBe('maps-registry');
  });

  it('declares no duplicate namespaces', () => {
    expect(new Set(CACHE_NAMESPACES).size).toBe(CACHE_NAMESPACES.length);
  });

  // A namespace that is a prefix of another would collide if the payload were
  // appended without a separator: `ft-toc` + `index-v2:...` reads the same as
  // `ft-tocindex-v2` + `...`. Both exist, so this is not hypothetical.
  it('keeps prefix-sharing namespaces apart', () => {
    const toc = cacheKey('ft-toc', { locale: 'en-US', product: 'jamf-pro', version: 'current' });
    const index = cacheKey('ft-tocindex-v2', { mapId: 'm1' });
    expect(toc.startsWith('ft-toc:')).toBe(true);
    expect(index.startsWith('ft-tocindex-v2:')).toBe(true);
    expect(toc).not.toBe(index);
  });

  it('THE ORIGINAL COLLISION', () => {
    const k1 = buildSearchCacheKey({
      query: 'FileVault', contentLocale: 'en-US', sortId: 'relevance',
      paging: { perPage: 100, page: 1 },
      filters: [{ key: 'zoominmetadata', values: ['product-pro'] }, { key: 'version', values: ['11.5'] }],
    });
    const k2 = buildSearchCacheKey({
      query: 'FileVault', contentLocale: 'en-US', sortId: 'relevance',
      paging: { perPage: 100, page: 1 },
      filters: [{ key: 'version', values: ['11.5|zoominmetadata=product-pro'] }],
    });
    expect(k1).not.toBe(k2);
  });

  it('filter order does not change the key', () => {
    const base = { query: 'q', contentLocale: 'en-US', sortId: 'relevance', paging: { perPage: 100, page: 1 } } as const;
    const f1 = [{ key: 'ab', values: ['c'] }, { key: 'a', values: ['bc'] }];
    const f2 = [{ key: 'a', values: ['bc'] }, { key: 'ab', values: ['c'] }];
    expect(buildSearchCacheKey({ ...base, filters: f1 }))
      .toBe(buildSearchCacheKey({ ...base, filters: f2 }));
  });

  // Fluid Topics topic metadata carries no `readerUrl`, so the article's
  // `displayUrl` — stored in the entry and used as the base for internal-link
  // resolution — is always the caller's URL. Fetching by mapId+contentId
  // passes '', so without articleUrl in the key that call would cache an
  // article with an empty url and serve it to everyone who asked by URL.
  it('distinguishes an article fetched by URL from the same one fetched by ids', () => {
    const byUrl = cacheKey('ft-article-v3', {
      mapId: 'm1', contentId: 'c1',
      articleUrl: 'https://learn.jamf.com/en-US/bundle/b/page/p.html',
    });
    const byIds = cacheKey('ft-article-v3', { mapId: 'm1', contentId: 'c1', articleUrl: '' });
    expect(byUrl).not.toBe(byIds);
  });

  // JSON.stringify maps NaN and Infinity to `null`, so without the guard they
  // and a genuine null would all key one entry — the exact collision class this
  // module exists to prevent. Unreachable from current callers; the throw is
  // there so a future one fails at the call site instead of silently sharing.
  it('rejects non-finite numbers rather than collapsing them onto null', () => {
    const base = {
      query: 'q', contentLocale: null, sortId: null, page: 1,
      filters: [] as const,
    };
    expect(() => cacheKey('ft-search', { ...base, perPage: NaN })).toThrow(TypeError);
    expect(() => cacheKey('ft-search', { ...base, perPage: Infinity })).toThrow(/only finite numbers/);
    expect(() => cacheKey('ft-search', { ...base, perPage: 100 })).not.toThrow();
  });
});
