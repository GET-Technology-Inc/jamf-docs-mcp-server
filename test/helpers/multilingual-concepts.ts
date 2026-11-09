/**
 * concepts.jamf.com as it was published until early November 2026: ten
 * locale codes, each listing the same 99 paths (measured 2026-09-28). The site
 * has been English-only since (2026-11-09: 85 paths, all under /en/), and the
 * source now declares en-US alone.
 *
 * The suites that mock this in pin the sitemap-driven multi-edition machinery
 * — per-locale tables of contents, listed titles, edition switching on
 * `get_article` — which no live source exercises today but which still runs
 * for any source that declares more than one locale. They keep the old table
 * rather than lose that coverage:
 *
 * ```ts
 * vi.mock('../../../src/core/constants/sources.js', async (importOriginal) =>
 *   (await import('../../helpers/multilingual-concepts.js'))
 *     .withMultilingualConcepts(await importOriginal()));
 * ```
 */

import type * as Sources from '../../src/core/constants/sources.js';

/** concepts.jamf.com's locale table until early November 2026. */
export const MULTILINGUAL_CONCEPTS_LOCALES = {
  'en-US': 'en',
  'ja-JP': 'ja',
  'de-DE': 'de',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'nl-NL': 'nl',
  'zh-TW': 'zh-TW',
  'zh-CN': 'zh-CN',
} as const;

/** The codes it published under that no `language` value names. */
export const MULTILINGUAL_CONCEPTS_OTHER_LOCALES = ['ko', 'pl'] as const;

/**
 * The sources module, with concepts.jamf.com's multi-locale table restored.
 *
 * Patched in place, not copied: `staticSourceForUrl`, `STATIC_SECTIONS` and
 * the rest read the module's own table, so a copy in the mocked export would
 * reach callers that index `STATIC_DOC_SOURCES` and miss every other path.
 * Vitest gives each test file its own module graph, so the patch stays in the
 * file that mocks it.
 */
export function withMultilingualConcepts(actual: typeof Sources): typeof Sources {
  Object.assign(actual.STATIC_DOC_SOURCES['jamf-concepts'], {
    locales: MULTILINGUAL_CONCEPTS_LOCALES,
    otherLocales: MULTILINGUAL_CONCEPTS_OTHER_LOCALES,
  });
  return actual;
}
