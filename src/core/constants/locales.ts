/**
 * Locale constants for Jamf documentation
 */

// Supported locales for Jamf documentation (learn.jamf.com)
export const DEFAULT_LOCALE = 'en-US';

export const SUPPORTED_LOCALES = {
  'en-US': { name: 'English' },
  'ja-JP': { name: '日本語' },
  'zh-TW': { name: '繁體中文' },
  'de-DE': { name: 'Deutsch' },
  'es-ES': { name: 'Español' },
  'fr-FR': { name: 'Français' },
  'nl-NL': { name: 'Nederlands' },
  'th-TH': { name: 'ไทย' },
} as const;

export type LocaleId = keyof typeof SUPPORTED_LOCALES;
export const SUPPORTED_LOCALE_IDS = Object.keys(SUPPORTED_LOCALES) as [string, ...string[]];

export function toValidLocale(candidate: string): LocaleId {
  return candidate in SUPPORTED_LOCALES ? candidate as LocaleId : DEFAULT_LOCALE;
}
