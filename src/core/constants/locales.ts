/**
 * Locale constants for Jamf documentation
 */

// Supported locales for Jamf documentation (learn.jamf.com)
export const DEFAULT_LOCALE = 'en-US';

/**
 * Every locale Jamf actually publishes documentation in.
 *
 * Measured against all 662 maps of `/api/khub/maps` on 2026-09-02, ordered by
 * how much content each carries:
 *
 *   en-US 194 maps / 97 families    nl-NL 10 / 10
 *   fr-FR  92 / 55                  pt-BR  2 / 2
 *   de-DE  91 / 54                  th-TH  2 / 2
 *   es-ES  91 / 54                  zh-CN  2 / 2
 *   ja-JP  91 / 54                  it-IT  2 / 2
 *   zh-TW  85 / 48
 *
 * `it-IT`, `pt-BR` and `zh-CN` were previously left undeclared on the reading
 * that Fluid Topics listed them in `availableContentLocales` without shipping
 * anything under them. That is no longer true: each carries the Jamf Parent
 * and Jamf Teacher guides, and each returns a real five-node TOC in its own
 * language ("Introduzione a Jamf Parent", "Introdução ao Jamf Parent",
 * "开始使用Jamf Parent"). They sit at the bottom of the list for the same
 * reason th-TH does — those two guides are published in 11 locales, the
 * widest in the library, while everything else tops out at six.
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
