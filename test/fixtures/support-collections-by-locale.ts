/**
 * support.jamf.com's top-level collections in each of its six locales, as
 * each locale's home page lists them, captured 2026-09-28.
 *
 * What these hold that no one locale shows: a collection's id is Intercom's,
 * and one collection keeps it in every locale it is published in, while its
 * slug, its name and its URL are the locale's own. Jamf Pro is 12369024 in
 * all six, slugged `jamf-pro-相關` in zh-TW; Jamf Connect for macOS is
 * 12380144 and `jamf-connect-pour-macos` in fr. Six of the nine en
 * collections are published in en alone.
 *
 * `entries` is the size of the collection's tree as its page gives it
 * (articles directly in it, its subcollections, and theirs). `first` is the
 * first entry of that tree: an article where the collection holds one
 * directly, else its first subcollection. Only `first` goes into the pages
 * the tests serve; the rest of each tree is left out.
 */
export interface SupportCollectionFixture {
  id: string;
  slug: string;
  name: string;
  entries: number;
  first: { kind: 'article' | 'collection'; title: string; url: string };
}

/** Keyed by support.jamf.com's own locale code, as its URLs spell it. */
export const SUPPORT_COLLECTIONS_BY_LOCALE: Readonly<Partial<Record<string, readonly SupportCollectionFixture[]>>> = {
  'en': [
    {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 384,
      first: { kind: 'article', title: 'Grant Secure Token to Enable FileVault', url: 'https://support.jamf.com/en/articles/11584648-grant-secure-token-to-enable-filevault' },
    },
    {
      id: '11814179', slug: 'jamf-account', name: 'Jamf Account', entries: 27,
      first: { kind: 'article', title: "Resolving 'You are not authorized to manage products for your organization' in Jamf Account", url: 'https://support.jamf.com/en/articles/12292751-resolving-you-are-not-authorized-to-manage-products-for-your-organization-in-jamf-account' },
    },
    {
      id: '12379857', slug: 'jamf-protect-macos-security-portal', name: 'Jamf Protect - macOS Security Portal', entries: 18,
      first: { kind: 'article', title: 'Computer is not checking in to Jamf Protect', url: 'https://support.jamf.com/en/articles/11643189-computer-is-not-checking-in-to-jamf-protect' },
    },
    {
      id: '12379846', slug: 'jamf-security-cloud-portal', name: 'Jamf Security Cloud Portal', entries: 14,
      first: { kind: 'article', title: 'Jamf Connect for iOS Devices', url: 'https://support.jamf.com/en/articles/11643487-jamf-connect-for-ios-devices' },
    },
    {
      id: '12380144', slug: 'jamf-connect-for-macos', name: 'Jamf Connect for macOS', entries: 54,
      first: { kind: 'article', title: 'Allow local login at the Jamf Connect Login Window', url: 'https://support.jamf.com/en/articles/11642308-allow-local-login-at-the-jamf-connect-login-window' },
    },
    {
      id: '12379841', slug: 'jamf-school', name: 'Jamf School', entries: 222,
      first: { kind: 'article', title: 'App Not Appearing Under Managed App Section Due to App Compatibility in Jamf School', url: 'https://support.jamf.com/en/articles/11632357-app-not-appearing-under-managed-app-section-due-to-app-compatibility-in-jamf-school' },
    },
    {
      id: '12379936', slug: 'jamf-safe-internet', name: 'Jamf Safe Internet', entries: 13,
      first: { kind: 'article', title: "Understanding Start/End vs. Recurrence in Jamf Safe Internet 'Schedules'", url: 'https://support.jamf.com/en/articles/11643269-understanding-start-end-vs-recurrence-in-jamf-safe-internet-schedules' },
    },
    {
      id: '12369113', slug: 'jamf-now', name: 'Jamf Now', entries: 145,
      first: { kind: 'article', title: 'Finding APNs Topics on Jamf Now Enrollment Profiles', url: 'https://support.jamf.com/en/articles/11476715-finding-apns-topics-on-jamf-now-enrollment-profiles' },
    },
    {
      id: '18272014', slug: 'elevate', name: 'Elevate', entries: 5,
      first: { kind: 'article', title: 'Accessing Jamf Apps - Elevate, Jamf Pro, Jamf Protect macOS Security portal, Jamf Security Cloud portal', url: 'https://support.jamf.com/en/articles/13575701-accessing-jamf-apps-elevate-jamf-pro-jamf-protect-macos-security-portal-jamf-security-cloud-portal' },
    },
  ],
  'fr': [
    {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 9,
      first: { kind: 'collection', title: 'Self Service', url: 'https://support.jamf.com/fr/collections/12380114-self-service' },
    },
    {
      id: '11814179', slug: 'jamf-account', name: 'Jamf Account', entries: 12,
      first: { kind: 'collection', title: 'Obtenir de l’aide de Jamf', url: 'https://support.jamf.com/fr/collections/12671126-obtenir-de-l-aide-de-jamf' },
    },
    {
      id: '12380144', slug: 'jamf-connect-pour-macos', name: 'Jamf Connect pour macOS', entries: 2,
      first: { kind: 'collection', title: 'Licences', url: 'https://support.jamf.com/fr/collections/12468553-licences' },
    },
  ],
  'de': [
    {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 9,
      first: { kind: 'collection', title: 'Self Service', url: 'https://support.jamf.com/de/collections/12380114-self-service' },
    },
    {
      id: '11814179', slug: 'jamf-account', name: 'Jamf Account', entries: 12,
      first: { kind: 'collection', title: 'Hilfe von Jamf erhalten', url: 'https://support.jamf.com/de/collections/12671126-hilfe-von-jamf-erhalten' },
    },
    {
      id: '12380144', slug: 'jamf-connect-fur-macos', name: 'Jamf Connect für macOS', entries: 2,
      first: { kind: 'collection', title: 'Lizenzierung', url: 'https://support.jamf.com/de/collections/12468553-lizenzierung' },
    },
  ],
  'ja': [
    {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 7,
      first: { kind: 'collection', title: 'Self Service', url: 'https://support.jamf.com/ja/collections/12380114-self-service' },
    },
    {
      id: '11814179', slug: 'jamf-account', name: 'Jamf Account', entries: 12,
      first: { kind: 'collection', title: 'Jamfからサポートを受ける', url: 'https://support.jamf.com/ja/collections/12671126-jamfからサポートを受ける' },
    },
  ],
  'es': [
    {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 9,
      first: { kind: 'collection', title: 'Autoservicio', url: 'https://support.jamf.com/es/collections/12380114-autoservicio' },
    },
    {
      id: '11814179', slug: 'jamf-account', name: 'Jamf Account', entries: 12,
      first: { kind: 'collection', title: 'Obtener ayuda de Jamf', url: 'https://support.jamf.com/es/collections/12671126-obtener-ayuda-de-jamf' },
    },
    {
      id: '12380144', slug: 'jamf-connect-para-macos', name: 'Jamf Connect para macOS', entries: 2,
      first: { kind: 'collection', title: 'Licencias', url: 'https://support.jamf.com/es/collections/12468553-licencias' },
    },
  ],
  'zh-TW': [
    {
      id: '12369024', slug: 'jamf-pro-相關', name: 'Jamf Pro 相關', entries: 10,
      first: { kind: 'collection', title: '自助服務', url: 'https://support.jamf.com/zh-TW/collections/12380114-自助服務' },
    },
    {
      id: '11814179', slug: 'jamf-帳號', name: 'Jamf 帳號', entries: 11,
      first: { kind: 'collection', title: '取得 Jamf 協助', url: 'https://support.jamf.com/zh-TW/collections/12671126-取得-jamf-協助' },
    },
  ],
};
