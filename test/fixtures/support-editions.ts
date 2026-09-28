/**
 * Three support.jamf.com pages as Intercom served them on 2026-09-28, trimmed
 * to what the reader reads: each edition's title, breadcrumbs and first two
 * blocks (an article) or its name, description, breadcrumbs and article list
 * (a collection), and the page's `localeLinks`.
 *
 * `localeLinks` is the page's own list of its editions, the same on every
 * edition of it (compared on all six editions of the first article). A locale
 * with an edition is `available`, and its `absoluteUrl` is that edition's
 * address, slug and all, raw as the site spells it. A locale without one is
 * not, and its `absoluteUrl` is the bare `/<locale>/articles/<id>`, which
 * support.jamf.com answers with a 301 to the en edition.
 *
 * - `RENEW_PUSH_CERTIFICATE` is one of the 11 articles, of the 820 the sitemap
 *   lists, that have an edition in all six locales.
 * - `JC_LOGIN_BLACK_SCREEN` is one of the 799 that have an en edition only.
 * - `SELF_SERVICE_PLUS` is one of the 24 subcollections of Jamf Pro, which
 *   `jamf_docs_get_toc` lists by their collection page's URL. Its en edition
 *   lists 27 articles, and its ja edition 1.
 *
 * Where an edition has `relatedArticles`, they are its
 * `articleContent.relatedArticles`, as the page listed them the same day.
 */

/** A page's own list of its editions, as its `localeLinks` gives it. */
export interface LocaleLinkFixture {
  id: string;
  absoluteUrl: string;
  available: boolean;
}

export interface CrumbFixture {
  name: string;
  url: string;
}

export interface ArticleEditionFixture {
  title: string;
  blocks: readonly { type: string; text: string }[];
  breadcrumbs: readonly CrumbFixture[];
  /** Each url raw, as the page spells it. */
  relatedArticles?: readonly { title: string; url: string }[];
}

export interface CollectionEditionFixture {
  name: string;
  description: string;
  articleSummaries: readonly { title: string; url: string }[];
  breadcrumbs: readonly CrumbFixture[];
}

export interface SupportPageFixture<Edition> {
  localeLinks: readonly LocaleLinkFixture[];
  /** Each edition the site publishes, by its locale code. */
  editions: Readonly<Record<string, Edition>>;
}

export const RENEW_PUSH_CERTIFICATE: SupportPageFixture<ArticleEditionFixture> = {
  localeLinks: [
    { id: 'en', absoluteUrl: 'https://support.jamf.com/en/articles/11016634-renew-your-mdm-push-notification-certificate-in-jamf-pro', available: true },
    { id: 'fr', absoluteUrl: 'https://support.jamf.com/fr/articles/11016634-renouvelez-votre-certificat-de-notification-push-mdm-dans-jamf-pro', available: true },
    { id: 'de', absoluteUrl: 'https://support.jamf.com/de/articles/11016634-erneuern-sie-ihr-mdm-push-benachrichtigungszertifikat-in-jamf-pro', available: true },
    { id: 'ja', absoluteUrl: 'https://support.jamf.com/ja/articles/11016634-jamf-pro-で-mdm-プッシュ通知証明書を更新する', available: true },
    { id: 'es', absoluteUrl: 'https://support.jamf.com/es/articles/11016634-renueve-su-certificado-de-notificaciones-push-mdm-en-jamf-pro', available: true },
    { id: 'zh-TW', absoluteUrl: 'https://support.jamf.com/zh-TW/articles/11016634-在-jamf-pro-中更新您的-mdm-推播通知憑證', available: true },
  ],
  editions: {
    en: {
      title: 'Renew your MDM Push Notification Certificate in Jamf Pro',
      blocks: [
        { type: 'heading', text: 'Description' },
        { type: 'paragraph', text: 'Your Apple Push Notification service (APNs) certificate, also known as the Push Certificate, has to be renewed yearly for managed devices to communicate with Jamf Pro. It is crucial to renew the certificate using the same Apple ID that was used during the original setup to avoid losing device communication with Jamf Pro which includes functionalities like MDM commands and app deployments.' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/en/collections/12369024-jamf-pro' },
        { name: 'Push Certificates', url: 'https://support.jamf.com/en/collections/12468624-push-certificates' },
      ],
    },
    fr: {
      title: 'Renouvelez votre certificat de notification push MDM dans Jamf Pro',
      blocks: [
        { type: 'heading', text: 'Description' },
        { type: 'paragraph', text: 'Votre certificat Apple Push Notification Service (APNs), également appelé certificat Push, doit être renouvelé chaque année afin que les appareils gérés puissent continuer à communiquer avec Jamf Pro.' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/fr/collections/12369024-jamf-pro' },
        { name: 'Certificats push', url: 'https://support.jamf.com/fr/collections/12468624-certificats-push' },
      ],
    },
    de: {
      title: 'Erneuern Sie Ihr MDM-Push-Benachrichtigungszertifikat in Jamf Pro',
      blocks: [
        { type: 'heading', text: 'Beschreibung' },
        { type: 'paragraph', text: 'Ihr Apple Push-Benachrichtigungsdienst-Zertifikat (APNs), auch bekannt als Push-Zertifikat, muss jährlich erneuert werden, damit verwaltete Geräte mit Jamf Pro kommunizieren können.' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/de/collections/12369024-jamf-pro' },
        { name: 'Push-Zertifikate', url: 'https://support.jamf.com/de/collections/12468624-push-zertifikate' },
      ],
    },
    ja: {
      title: 'Jamf Pro で MDM プッシュ通知証明書を更新する',
      blocks: [
        { type: 'heading', text: '説明' },
        { type: 'paragraph', text: 'Apple プッシュ通知サービス（APNs）証明書は、プッシュ証明書とも呼ばれ、管理対象デバイスが Jamf Pro と通信するために毎年更新する必要があります。' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/ja/collections/12369024-jamf-pro' },
        { name: 'プッシュ証明書', url: 'https://support.jamf.com/ja/collections/12468624-プッシュ証明書' },
      ],
      relatedArticles: [
        { title: 'プッシュ証明書の作成に使用されたAppleアカウントの確認', url: 'https://support.jamf.com/ja/articles/11016585-プッシュ証明書の作成に使用されたappleアカウントの確認' },
        { title: 'Jamf ID で Jamf アカウントにログインできない場合', url: 'https://support.jamf.com/ja/articles/11645274-jamf-id-で-jamf-アカウントにログインできない場合' },
        { title: 'Jamf ID の多要素認証（MFA）が機能しない場合', url: 'https://support.jamf.com/ja/articles/11647778-jamf-id-の多要素認証-mfa-が機能しない場合' },
        { title: 'ID プロバイダの認証情報で Jamf アカウントにログインできない場合', url: 'https://support.jamf.com/ja/articles/11657440-id-プロバイダの認証情報で-jamf-アカウントにログインできない場合' },
      ],
    },
    es: {
      title: 'Renueve su Certificado de Notificaciones Push MDM en Jamf Pro',
      blocks: [
        { type: 'heading', text: 'Descripción' },
        { type: 'paragraph', text: 'Su certificado del servicio de notificaciones push de Apple (APNs), también conocido como certificado push, debe renovarse anualmente para que los dispositivos puedan comunicarse con Jamf Pro.' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/es/collections/12369024-jamf-pro' },
        { name: 'Certificados push', url: 'https://support.jamf.com/es/collections/12468624-certificados-push' },
      ],
    },
    'zh-TW': {
      title: '在 Jamf Pro 中更新您的 MDM 推播通知憑證',
      blocks: [
        { type: 'heading', text: '描述' },
        { type: 'paragraph', text: '您的 Apple 推播通知服務（APNs）憑證，也稱為推播憑證，必須每年更新一次，才能讓受管理的裝置與 Jamf Pro 進行通訊。' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro 相關', url: 'https://support.jamf.com/zh-TW/collections/12369024-jamf-pro-相關' },
        { name: '推播憑證', url: 'https://support.jamf.com/zh-TW/collections/12468624-推播憑證' },
      ],
    },
  },
};

export const JC_LOGIN_BLACK_SCREEN: SupportPageFixture<ArticleEditionFixture> = {
  localeLinks: [
    { id: 'en', absoluteUrl: 'https://support.jamf.com/en/articles/11730439-jamf-connect-login-jc-l-via-intune-causes-black-screen', available: true },
    { id: 'fr', absoluteUrl: 'https://support.jamf.com/fr/articles/11730439', available: false },
    { id: 'de', absoluteUrl: 'https://support.jamf.com/de/articles/11730439', available: false },
    { id: 'ja', absoluteUrl: 'https://support.jamf.com/ja/articles/11730439', available: false },
    { id: 'es', absoluteUrl: 'https://support.jamf.com/es/articles/11730439', available: false },
    { id: 'zh-TW', absoluteUrl: 'https://support.jamf.com/zh-TW/articles/11730439', available: false },
  ],
  editions: {
    en: {
      title: 'Jamf Connect Login (JC:L) via Intune Causes Black Screen',
      blocks: [
        { type: 'heading', text: 'Issue Description' },
        { type: 'paragraph', text: 'Shortly after the Jamf Connect Login (JC:L) screen is displayed, the screen will go black for a few seconds until JC:L reloads.' },
      ],
      breadcrumbs: [
        { name: 'Jamf Connect for macOS', url: 'https://support.jamf.com/en/collections/12380144-jamf-connect-for-macos' },
      ],
      relatedArticles: [
        { title: 'MacOS 14.2 and Jamf Connect 2.27 or 2.28 Results in a Black Screen for Jamf Connect Login', url: 'https://support.jamf.com/en/articles/11003396-macos-14-2-and-jamf-connect-2-27-or-2-28-results-in-a-black-screen-for-jamf-connect-login' },
        { title: 'Jamf Connect Menu Bar Password Change Window not Passing Device Compliance with Entra ID', url: 'https://support.jamf.com/en/articles/11003428-jamf-connect-menu-bar-password-change-window-not-passing-device-compliance-with-entra-id' },
        { title: 'Creating Jamf Connect Configuration Profiles using Jamf Pro', url: 'https://support.jamf.com/en/articles/11003523-creating-jamf-connect-configuration-profiles-using-jamf-pro' },
        { title: 'Standardized Introduction Workflow for Jamf Connect Login', url: 'https://support.jamf.com/en/articles/11003611-standardized-introduction-workflow-for-jamf-connect-login' },
        { title: 'Log in at Jamf Connect login window if password was forgotten and reset in the identity provider', url: 'https://support.jamf.com/en/articles/11869912-log-in-at-jamf-connect-login-window-if-password-was-forgotten-and-reset-in-the-identity-provider' },
      ],
    },
  },
};

export const SELF_SERVICE_PLUS: SupportPageFixture<CollectionEditionFixture> = {
  localeLinks: [
    { id: 'en', absoluteUrl: 'https://support.jamf.com/en/collections/12380114-self-service', available: true },
    { id: 'fr', absoluteUrl: 'https://support.jamf.com/fr/collections/12380114-self-service', available: true },
    { id: 'de', absoluteUrl: 'https://support.jamf.com/de/collections/12380114-self-service', available: true },
    { id: 'ja', absoluteUrl: 'https://support.jamf.com/ja/collections/12380114-self-service', available: true },
    { id: 'es', absoluteUrl: 'https://support.jamf.com/es/collections/12380114-autoservicio', available: true },
    { id: 'zh-TW', absoluteUrl: 'https://support.jamf.com/zh-TW/collections/12380114-自助服務', available: true },
  ],
  editions: {
    en: {
      name: 'Self Service+',
      description: 'Self Service+ is an end user application for macOS that allows users to access content and updates that have been preconfigured in Jamf Pro.',
      articleSummaries: [
        { title: 'Self Service must be associated with Jamf Server', url: 'https://support.jamf.com/en/articles/10631329-self-service-must-be-associated-with-jamf-server' },
        { title: 'Self Service Crashes on Launch', url: 'https://support.jamf.com/en/articles/11030013-self-service-crashes-on-launch' },
        { title: 'Self Service Policy Icons Incorrect', url: 'https://support.jamf.com/en/articles/11030014-self-service-policy-icons-incorrect' },
        { title: 'Update Icon for Self Service Policy in Jamf Pro', url: 'https://support.jamf.com/en/articles/11030069-update-icon-for-self-service-policy-in-jamf-pro' },
        { title: 'App request with Self Service', url: 'https://support.jamf.com/en/articles/11032396-app-request-with-self-service' },
        { title: 'Self Service Header', url: 'https://support.jamf.com/en/articles/11032402-self-service-header' },
        { title: 'How to Apply "Feature the app" Category', url: 'https://support.jamf.com/en/articles/11032416-how-to-apply-feature-the-app-category' },
        { title: 'Create Custom Notifications for macOS Self Service', url: 'https://support.jamf.com/en/articles/11032419-create-custom-notifications-for-macos-self-service' },
        { title: 'Editing Self Service Description of Manually Added Mac App Store Apps Including iOS Apps', url: 'https://support.jamf.com/en/articles/11032427-editing-self-service-description-of-manually-added-mac-app-store-apps-including-ios-apps' },
        { title: 'Self Service - "Failed to initialize the applications saved data"', url: 'https://support.jamf.com/en/articles/11032447-self-service-failed-to-initialize-the-applications-saved-data' },
        { title: 'Jamf Pro Self Service showing "There was an error enrolling your device: ENROLLMENT_STATUS_FAIL"', url: 'https://support.jamf.com/en/articles/11032515-jamf-pro-self-service-showing-there-was-an-error-enrolling-your-device-enrollment_status_fail' },
        { title: 'Deploy Jamf Pro Self Service Notifications to Specific Users', url: 'https://support.jamf.com/en/articles/11032525-deploy-jamf-pro-self-service-notifications-to-specific-users' },
        { title: 'Clean Re-install of Self Service for macOS', url: 'https://support.jamf.com/en/articles/11032544-clean-re-install-of-self-service-for-macos' },
        { title: 'Jamf Pro Branding self service Icon', url: 'https://support.jamf.com/en/articles/11032548-jamf-pro-branding-self-service-icon' },
        { title: 'Self Service with MFA Auth Crashes Upon Login Due to Fido2 Auth Not Being Enabled in Jamf Pro', url: 'https://support.jamf.com/en/articles/11032558-self-service-with-mfa-auth-crashes-upon-login-due-to-fido2-auth-not-being-enabled-in-jamf-pro' },
        { title: 'Bundle Identifier for Self Service+', url: 'https://support.jamf.com/en/articles/11032599-bundle-identifier-for-self-service' },
        { title: 'Adding Jamf Protect to the Security Dashboard in Self Service+', url: 'https://support.jamf.com/en/articles/11038489-adding-jamf-protect-to-the-security-dashboard-in-self-service' },
        { title: 'Jamf Pro User unable to save Scripts', url: 'https://support.jamf.com/en/articles/11030543-jamf-pro-user-unable-to-save-scripts' },
        { title: 'Self Service Error - Can\'t Connect to Server after Jamf Pro Re-enrollment', url: 'https://support.jamf.com/en/articles/11032539-self-service-error-can-t-connect-to-server-after-jamf-pro-re-enrollment' },
        { title: 'Self Service Unable to Connect to Server on macOS Catalina (Jamf Pro 11.11+)', url: 'https://support.jamf.com/en/articles/11032569-self-service-unable-to-connect-to-server-on-macos-catalina-jamf-pro-11-11' },
        { title: 'SMTP Failure in Jamf Pro', url: 'https://support.jamf.com/en/articles/11032678-smtp-failure-in-jamf-pro' },
        { title: 'Missing MIME Type for In-House Ebooks on Window Servers', url: 'https://support.jamf.com/en/articles/11034103-missing-mime-type-for-in-house-ebooks-on-window-servers' },
        { title: 'Self Service+ 2.9.x Releases', url: 'https://support.jamf.com/en/articles/12401638-self-service-2-9-x-releases' },
        { title: 'Communication Errors with Self Service +', url: 'https://support.jamf.com/en/articles/16128039-communication-errors-with-self-service' },
        { title: 'Self Service+ Installation Troubleshooting on macOS', url: 'https://support.jamf.com/en/articles/16892835-self-service-installation-troubleshooting-on-macos' },
        { title: 'Uninstalling Self Service +', url: 'https://support.jamf.com/en/articles/16988414-uninstalling-self-service' },
        { title: 'Troubleshooting Self Service+ Slowness on iOS Devices', url: 'https://support.jamf.com/en/articles/17068611-troubleshooting-self-service-slowness-on-ios-devices' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/en/collections/12369024-jamf-pro' },
      ],
    },
    ja: {
      name: 'Self Service',
      description: '',
      articleSummaries: [
        { title: 'Self Service は Jamf サーバーに関連付けられている必要があります', url: 'https://support.jamf.com/ja/articles/10631329-self-service-は-jamf-サーバーに関連付けられている必要があります' },
      ],
      breadcrumbs: [
        { name: 'Jamf Pro', url: 'https://support.jamf.com/ja/collections/12369024-jamf-pro' },
      ],
    },
  },
};
