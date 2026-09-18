/**
 * Locale constants for Jamf documentation
 */

// Supported locales for Jamf documentation (learn.jamf.com)
export const DEFAULT_LOCALE = 'en-US';

/**
 * Every locale Jamf actually publishes documentation in.
 *
 * Measured against all 676 maps of `/api/khub/maps` on 2026-09-14, ordered by
 * how much content each carries:
 *
 *   en-US 198 maps / 97 families    nl-NL 10 / 10
 *   fr-FR  94 / 55                  pt-BR  2 / 2
 *   de-DE  93 / 54                  th-TH  2 / 2
 *   es-ES  93 / 54                  zh-CN  2 / 2
 *   ja-JP  93 / 54                  it-IT  2 / 2
 *   zh-TW  87 / 48
 *
 * Both columns move with Jamf's publishing: 11.32.0 alone added 14 maps
 * between the 2026-09-02 and 2026-09-14 measurements, and en-US went from 97
 * families to 98 by 2026-09-18. An earlier version of this comment said the
 * family column "did not move at all" and invited the reader to ignore drift
 * in it — which is exactly the drift that then happened. Only the ORDERING is
 * load-bearing here, so any later mismatch in either column is Jamf
 * publishing rather than a defect.
 *
 * `it-IT`, `pt-BR` and `zh-CN` were previously left undeclared on the reading
 * that Fluid Topics listed them in `availableContentLocales` without shipping
 * anything under them. That is no longer true: each carries the Jamf Parent
 * and Jamf Teacher guides, and each returns a real five-node TOC in its own
 * language ("Introduzione a Jamf Parent", "Introdução ao Jamf Parent",
 * "开始使用Jamf Parent"). They sit at the bottom of the list for the same
 * reason th-TH does — those two guides are published in 11 locales, the
 * widest in the library, while everything else tops out at seven (the Jamf
 * Parent, Jamf Teacher and Jamf School Blueprints configuration guides).
 */
export const SUPPORTED_LOCALES = {
  'en-US': { name: 'English' },
  'ja-JP': { name: '日本語' },
  'zh-TW': { name: '繁體中文' },
  'de-DE': { name: 'Deutsch' },
  'es-ES': { name: 'Español' },
  'fr-FR': { name: 'Français' },
  'nl-NL': { name: 'Nederlands' },
  'th-TH': { name: 'ไทย' },
  'it-IT': { name: 'Italiano' },
  'pt-BR': { name: 'Português (Brasil)' },
  'zh-CN': { name: '简体中文' },
} as const;

export type LocaleId = keyof typeof SUPPORTED_LOCALES;
export const SUPPORTED_LOCALE_IDS = Object.keys(SUPPORTED_LOCALES) as [string, ...string[]];

export function toValidLocale(candidate: string): LocaleId {
  return candidate in SUPPORTED_LOCALES ? candidate as LocaleId : DEFAULT_LOCALE;
}
