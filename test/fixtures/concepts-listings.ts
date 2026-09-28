/**
 * What concepts.jamf.com's section index pages list, in three of its
 * locales, captured 2026-09-28: the data `/{locale}/guides/` and
 * `/{locale}/concepts/` stream into themselves (static-titles.ts), cut to
 * the fields the titles and the guides' order are read from.
 *
 * - `nav`: the guides, by category, each under its slug and title. A
 *   category's `label` is in English in every locale. Each category and
 *   guide has the `navOrder` the site's sidebar lists it by, the same in
 *   every locale, and each list is in that order already.
 * - `guideCategoryLabels`: the name the guides index links 11 of the 16
 *   categories by, in the locale's language.
 * - `guide`: the index page's own guide, the section's overview.
 * - `concepts`: the tools, each under its slug and title. `mut` is listed
 *   and is not in the sitemap.
 *
 * {@link conceptsIndexPage} writes them into a page the way the site does.
 */

export interface NavCategory {
  id: string;
  label: string;
  navOrder: number;
  guides: { slug: string; title: string; navOrder: number }[];
  children: NavCategory[];
}

export interface ConceptsListing {
  guideCategoryLabels: Record<string, string>;
  guide: { slug: string; path: string; title: string };
  nav: NavCategory[];
  concepts: { slug: string; title: string }[];
}

export const CONCEPTS_LISTINGS: Readonly<Record<'en' | 'ja' | 'fr', ConceptsListing>> = {
  en: {
    guideCategoryLabels: {
      'device-trust-identity-and-deployment': 'Device Trust Identity and Deployment',
      'android-enterprise': 'Android Enterprise',
      byod: 'BYOD',
      'platform-single-sign-on': 'Platform SSO for macOS',
      'examples-and-demos': 'Examples and Demos',
      'getting-started-with-jamf-for-mac': 'Getting Started with Jamf for Mac',
      'infrastructure-as-code': 'Infrastructure As Code',
      'resource-access-control': 'Resource Access Control',
      'threat-and-risk-management': 'Threat and Risk Management',
      ai: 'AI',
      'data-loss-protection': 'Data Loss Protection',
    },
    guide: { slug: 'overview', path: 'overview', title: 'Overview' },
    nav: [
      {
        id: 'device-trust-identity-and-deployment',
        label: 'Device Trust Identity and Deployment',
        navOrder: 1,
        guides: [],
        children: [
          {
            id: 'android-enterprise',
            label: 'Android Enterprise',
            navOrder: 1,
            guides: [
              { slug: 'android-fully-managed', title: 'Android Fully Managed Devices', navOrder: 2 },
              {
                slug: 'work-profile-for-mixed-used-company-owned-devices',
                title: 'Work Profile for Mixed Use Company Owned Devices',
                navOrder: 3,
              },
            ],
            children: [],
          },
          {
            id: 'byod',
            label: 'BYOD',
            navOrder: 2,
            guides: [
              {
                slug: 'android-work-profile-for-employee-owned-devices',
                title: 'Work Profile for Employee-Owned Devices',
                navOrder: 1,
              },
              { slug: 'user-only-enrollments', title: 'User-Only Enrollments', navOrder: 3 },
            ],
            children: [{ id: 'android-enterprise-1', label: 'Android Enterprise', navOrder: 1, guides: [], children: [] }],
          },
          {
            id: 'platform-single-sign-on',
            label: 'Platform Single Sign-On',
            navOrder: 3,
            guides: [
              { slug: 'platform-sso-for-macos', title: 'Platform SSO for macOS', navOrder: 2 },
              {
                slug: 'psso-jamfpro-okta',
                title: 'Configuring Simplified Setup for Platform SSO using Jamf Pro and Okta',
                navOrder: 3,
              },
              { slug: 'jnuc-2025-sessions', title: 'Video Resources and Sessions', navOrder: 4 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'examples-and-demos',
        label: 'Examples and Demos',
        navOrder: 2,
        guides: [
          { slug: 'macos-corporate-owned-laptop', title: 'Corporate Owned Mac', navOrder: 2 },
          { slug: 'ios-corporate-owned-device', title: 'Corporate Owned iPhone', navOrder: 3 },
          { slug: 'ios-personally-owned-device', title: 'Personally Owned iPhone (BYOD)', navOrder: 4 },
          { slug: 'unmanaged-vision-pro', title: 'Unmanaged Vision Pro', navOrder: 5 },
          { slug: 'corporate-owned-android-demo-video', title: 'Corporate Owned Android', navOrder: 6 },
          { slug: 'personally-owned-android', title: 'Personally Owned Android (BYOD)', navOrder: 7 },
        ],
        children: [],
      },
      { id: 'getting-started-with-jamf-for-mac', label: 'Jamf for Mac', navOrder: 3, guides: [], children: [] },
      {
        id: 'infrastructure-as-code',
        label: 'Infrastructure As Code',
        navOrder: 4,
        guides: [
          {
            slug: 'resources-for-getting-started-with-terraform-and-jamf',
            title: 'Resources: Terraform, GitHub, and Jamf Configurations',
            navOrder: 1,
          },
          {
            slug: 'managing-jamf-pro-with-terraform-the-jamf-pro-provider',
            title: 'Managing Jamf Pro with Terraform: The Jamf Pro Provider',
            navOrder: 4,
          },
          {
            slug: 'managing-jamf-protect-with-terraform-the-jamf-protect-provider',
            title: 'Managing Jamf Protect with Terraform: The Jamf Protect Provider',
            navOrder: 5,
          },
          {
            slug: 'managing-the-jamf-platform-with-terraform-the-jamf-platform-provider',
            title: 'Managing the Jamf Platform with Terraform: the Jamf Platform provider',
            navOrder: 6,
          },
          {
            slug: 'adopting-terraform-for-jamf-with-jamformer',
            title: 'Adopting Terraform for Jamf with jamformer',
            navOrder: 7,
          },
        ],
        children: [],
      },
      {
        id: 'it-workflows',
        label: 'IT Workflows',
        navOrder: 5,
        guides: [],
        children: [
          {
            id: 'form-to-wipe',
            label: 'Form to Wipe',
            navOrder: 1,
            guides: [
              { slug: 'n8n', title: 'Form to Wipe — n8n Deployment', navOrder: 10 },
              { slug: 'github-actions', title: 'Form to Wipe — GitHub Actions Deployment', navOrder: 30 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'resource-access-control',
        label: 'Resource Access Control',
        navOrder: 6,
        guides: [
          { slug: 'protecting-your-mdm-management-plane', title: 'Protecting Your MDM Management Plane', navOrder: 1 },
          { slug: 'app-and-infrastructure-cloaking', title: 'App and Infrastructure Cloaking', navOrder: 2 },
          {
            slug: 'securing-self-hosted-llm-access-with-trusted-egress-ips',
            title: 'Securing LLM Access with Trusted Egress IPs',
            navOrder: 3,
          },
          { slug: 'enabling-access-for-trusted-devices', title: 'Enabling Access for Trusted Devices', navOrder: 4 },
          { slug: 'access-restriction-strategies', title: 'Restricting Access for Anonymous Devices', navOrder: 6 },
          {
            slug: 'attested-device-compliance-for-microsoft-entra',
            title: 'Attested Device Compliance for Microsoft Entra',
            navOrder: 7,
          },
          {
            slug: 'network-engineers-guide-to-private-access',
            title: 'Network Engineer\'s Guide to Jamf Connect ZTNA',
            navOrder: 15,
          },
        ],
        children: [],
      },
      {
        id: 'threat-and-risk-management',
        label: 'Threat and Risk Management',
        navOrder: 7,
        guides: [
          {
            slug: 'enforcing-compliance-baselines-for-network-access',
            title: 'Enforcing Compliance Baselines for Network Access',
            navOrder: 3,
          },
          {
            slug: 'establishing-compliance-baselines',
            title: 'Establishing Compliance Baselines with Compliance Editor',
            navOrder: 5,
          },
          {
            slug: 'build-reports-for-jamf-pro-compliance-benchmarks',
            title: 'Build reports for Jamf Pro compliance benchmarks',
            navOrder: 6,
          },
          { slug: 'siem-xdr-integration', title: 'SIEM & XDR Integration', navOrder: 9 },
        ],
        children: [
          {
            id: 'ai',
            label: 'AI',
            navOrder: 1,
            guides: [
              {
                slug: 'detecting-blocking-remediating-openclaw-using-jamf',
                title: 'Detecting, Blocking & Remediating OpenClaw using Jamf',
                navOrder: 1,
              },
            ],
            children: [],
          },
          {
            id: 'data-loss-protection',
            label: 'Data Loss Protection',
            navOrder: 2,
            guides: [
              { slug: 'dlp-deep-packet-inspection', title: 'Deep Packet Inspection', navOrder: 2 },
              { slug: 'saas-tenancy-control', title: 'SaaS Tenancy Control', navOrder: 3 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'jamf-for-mobile',
        label: 'Jamf for Mobile',
        navOrder: 8,
        guides: [
          { slug: 'jamf-device-checker', title: 'Jamf Device Checker', navOrder: 1 },
          { slug: 'jamf-mobile-assist-assigner', title: 'Jamf Mobile Assist - Assigner', navOrder: 2 },
          { slug: 'jamf-mobile-assist-device-helper', title: 'Jamf Mobile Assist - Device Helper', navOrder: 3 },
          { slug: 'jamf-return-to-service', title: 'Jamf Return to Service', navOrder: 4 },
        ],
        children: [],
      },
      {
        id: 'ai-governance',
        label: 'AI Governance',
        navOrder: 8,
        guides: [
          {
            slug: 'ai-governance-enforcement-with-jamf-extender',
            title: 'AI Governance: Extending Coverage with Jamf Extender',
            navOrder: 20,
          },
        ],
        children: [],
      },
    ],
    concepts: [
      { slug: 'apiutil', title: 'API Utility' },
      { slug: 'app-scoper', title: 'AppScoper' },
      { slug: 'ddm-explorer', title: 'DDM Explorer' },
      { slug: 'jamf-actions', title: 'Jamf Actions' },
      { slug: 'jamf-cli', title: 'Jamf CLI' },
      { slug: 'jamf-compliance-editor', title: 'Jamf Compliance Editor' },
      { slug: 'jamf-connect-resources', title: 'Jamf Connect Resources' },
      { slug: 'jamf-device-checker', title: 'Jamf Device Checker' },
      { slug: 'jamf-extender', title: 'Jamf Extender' },
      { slug: 'mcp-hub', title: 'Jamf MCP Hub' },
      { slug: 'jamf-mobile-assist', title: 'Jamf Mobile Assist' },
      { slug: 'jamfplatform-go-sdk', title: 'Jamf Platform Go SDK' },
      { slug: 'jamf-printer-manager', title: 'Jamf Printer Manager' },
      { slug: 'jamfprotect-go-sdk', title: 'Jamf Protect Go SDK' },
      { slug: 'jamf-protect-resources', title: 'Jamf Protect Resources' },
      { slug: 'jamf-return-to-service', title: 'Jamf Return to Service' },
      { slug: 'jamf-status', title: 'Jamf Status' },
      { slug: 'jamf-sync', title: 'Jamf Sync' },
      { slug: 'jamfcheck', title: 'JamfCheck' },
      { slug: 'jamformer', title: 'jamformer' },
      { slug: 'jawa', title: 'JAWA' },
      { slug: 'mut', title: 'Mass Update Tool (MUT)' },
      { slug: 'orchard-view', title: 'Orchard View' },
      { slug: 'pppc-utility', title: 'PPPC Utility' },
      { slug: 'psso-utility', title: 'PSSO Utility' },
      { slug: 'mcp-rapidid', title: 'RapidID MCP Server' },
      { slug: 'reenroller', title: 'ReEnroller' },
      { slug: 'remediasoar', title: 'RemediaSOAR' },
      { slug: 'replicator', title: 'Replicator' },
      { slug: 'saastenancy', title: 'SaaSTenancy' },
      { slug: 'setup-checklist', title: 'Setup Checklist' },
      { slug: 'setup-manager', title: 'Setup Manager' },
      { slug: 'simple-network-relay', title: 'Simple Network Relay' },
      { slug: 'terraform-provider-jamfautoupdate', title: 'Terraform Provider — Jamf Auto Update' },
      { slug: 'terraform-provider-jamfplatform', title: 'Terraform Provider — Jamf Platform' },
      { slug: 'terraform-provider-jamfprotect', title: 'Terraform Provider — Jamf Protect' },
      { slug: 'terraform-provider-jsctfprovider', title: 'Terraform Provider — Jamf Security Cloud' },
      { slug: 'wallpaper-designer', title: 'Wallpaper Designer' },
    ],
  },
  ja: {
    guideCategoryLabels: {
      'device-trust-identity-and-deployment': 'デバイストラストとID・デプロイメント',
      'android-enterprise': 'Android Enterprise',
      byod: 'BYOD',
      'platform-single-sign-on': 'Platform SSO for macOS',
      'examples-and-demos': '例とデモ',
      'getting-started-with-jamf-for-mac': 'Jamf for Mac入門',
      'infrastructure-as-code': 'Infrastructure as Code',
      'resource-access-control': 'リソースアクセス制御',
      'threat-and-risk-management': '脅威とリスク管理',
      ai: 'AI',
      'data-loss-protection': 'データ損失防止',
    },
    guide: { slug: 'overview', path: 'overview', title: '概要' },
    nav: [
      {
        id: 'device-trust-identity-and-deployment',
        label: 'Device Trust Identity and Deployment',
        navOrder: 1,
        guides: [],
        children: [
          {
            id: 'android-enterprise',
            label: 'Android Enterprise',
            navOrder: 1,
            guides: [
              { slug: 'android-fully-managed', title: 'Android フル管理デバイス', navOrder: 2 },
              {
                slug: 'work-profile-for-mixed-used-company-owned-devices',
                title: '混合用途企業所有デバイス向けWork Profile',
                navOrder: 3,
              },
            ],
            children: [],
          },
          {
            id: 'byod',
            label: 'BYOD',
            navOrder: 2,
            guides: [
              { slug: 'android-work-profile-for-employee-owned-devices', title: '従業員所有デバイス向けWork Profile', navOrder: 1 },
              { slug: 'user-only-enrollments', title: 'ユーザーのみの登録', navOrder: 3 },
            ],
            children: [{ id: 'android-enterprise-1', label: 'Android Enterprise', navOrder: 1, guides: [], children: [] }],
          },
          {
            id: 'platform-single-sign-on',
            label: 'Platform Single Sign-On',
            navOrder: 3,
            guides: [
              { slug: 'platform-sso-for-macos', title: 'macOS 用 Platform SSO', navOrder: 2 },
              { slug: 'psso-jamfpro-okta', title: 'Jamf Pro と Okta を使用した Platform SSO の簡易セットアップの構成', navOrder: 3 },
              { slug: 'jnuc-2025-sessions', title: 'ビデオリソースとセッション', navOrder: 4 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'examples-and-demos',
        label: 'Examples and Demos',
        navOrder: 2,
        guides: [
          { slug: 'macos-corporate-owned-laptop', title: '企業所有の Mac', navOrder: 2 },
          { slug: 'ios-corporate-owned-device', title: '企業所有iPhone', navOrder: 3 },
          { slug: 'ios-personally-owned-device', title: '個人所有の iPhone（BYOD）', navOrder: 4 },
          { slug: 'unmanaged-vision-pro', title: '非管理対象 Vision Pro', navOrder: 5 },
          { slug: 'corporate-owned-android-demo-video', title: '企業所有の Android', navOrder: 6 },
          { slug: 'personally-owned-android', title: '個人所有の Android（BYOD）', navOrder: 7 },
        ],
        children: [],
      },
      { id: 'getting-started-with-jamf-for-mac', label: 'Jamf for Mac', navOrder: 3, guides: [], children: [] },
      {
        id: 'infrastructure-as-code',
        label: 'Infrastructure As Code',
        navOrder: 4,
        guides: [
          {
            slug: 'resources-for-getting-started-with-terraform-and-jamf',
            title: 'リソース: Terraform、GitHub、Jamf 設定',
            navOrder: 1,
          },
          {
            slug: 'managing-jamf-pro-with-terraform-the-jamf-pro-provider',
            title: 'Terraform を使用した Jamf 構成管理の概要',
            navOrder: 4,
          },
          {
            slug: 'managing-jamf-protect-with-terraform-the-jamf-protect-provider',
            title: 'Terraform を使用した Jamf Protect の管理: Jamf Protect プロバイダー',
            navOrder: 5,
          },
          {
            slug: 'managing-the-jamf-platform-with-terraform-the-jamf-platform-provider',
            title: 'Terraform で Jamf Platform を管理する: Jamf Platform プロバイダー',
            navOrder: 6,
          },
          {
            slug: 'adopting-terraform-for-jamf-with-jamformer',
            title: 'Terraform と jamformer を使用して Jamf を導入する',
            navOrder: 7,
          },
        ],
        children: [],
      },
      {
        id: 'it-workflows',
        label: 'IT Workflows',
        navOrder: 5,
        guides: [],
        children: [
          {
            id: 'form-to-wipe',
            label: 'Form to Wipe',
            navOrder: 1,
            guides: [
              { slug: 'n8n', title: 'Form to Wipe — n8n Deployment', navOrder: 10 },
              { slug: 'github-actions', title: 'Form to Wipe — GitHub Actions Deployment', navOrder: 30 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'resource-access-control',
        label: 'Resource Access Control',
        navOrder: 6,
        guides: [
          { slug: 'protecting-your-mdm-management-plane', title: 'MDM管理プレーンの保護', navOrder: 1 },
          { slug: 'app-and-infrastructure-cloaking', title: 'アプリとインフラストラクチャのクローキング', navOrder: 2 },
          {
            slug: 'securing-self-hosted-llm-access-with-trusted-egress-ips',
            title: '信頼されたエグレス IP による LLM アクセスのセキュリティ保護',
            navOrder: 3,
          },
          { slug: 'enabling-access-for-trusted-devices', title: '信頼できるデバイスのアクセス許可を有効にする', navOrder: 4 },
          { slug: 'access-restriction-strategies', title: '匿名デバイスへのアクセス制限', navOrder: 6 },
          {
            slug: 'attested-device-compliance-for-microsoft-entra',
            title: 'Microsoft Entra向けの認証デバイスコンプライアンス',
            navOrder: 7,
          },
          { slug: 'network-engineers-guide-to-private-access', title: 'ネットワークエンジニア向け Jamf Connect ZTNA ガイド', navOrder: 15 },
        ],
        children: [],
      },
      {
        id: 'threat-and-risk-management',
        label: 'Threat and Risk Management',
        navOrder: 7,
        guides: [
          {
            slug: 'enforcing-compliance-baselines-for-network-access',
            title: 'ネットワークアクセスのコンプライアンスベースラインの実装',
            navOrder: 3,
          },
          { slug: 'establishing-compliance-baselines', title: 'Compliance Editorを使用したコンプライアンスベースラインの確立', navOrder: 5 },
          {
            slug: 'build-reports-for-jamf-pro-compliance-benchmarks',
            title: 'Jamf Pro コンプライアンスベンチマークのレポートを構築する',
            navOrder: 6,
          },
          { slug: 'siem-xdr-integration', title: 'SIEM & XDR 統合', navOrder: 9 },
        ],
        children: [
          {
            id: 'ai',
            label: 'AI',
            navOrder: 1,
            guides: [
              {
                slug: 'detecting-blocking-remediating-openclaw-using-jamf',
                title: 'Jamfを使用したOpenClawの検出、ブロック、および修復',
                navOrder: 1,
              },
            ],
            children: [],
          },
          {
            id: 'data-loss-protection',
            label: 'Data Loss Protection',
            navOrder: 2,
            guides: [
              { slug: 'dlp-deep-packet-inspection', title: 'Deep Packet Inspection', navOrder: 2 },
              { slug: 'saas-tenancy-control', title: 'SaaS テナンシー制御', navOrder: 3 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'jamf-for-mobile',
        label: 'Jamf for Mobile',
        navOrder: 8,
        guides: [
          { slug: 'jamf-device-checker', title: 'Jamf Device Checker', navOrder: 1 },
          { slug: 'jamf-mobile-assist-assigner', title: 'Jamf Mobile Assist - Assigner', navOrder: 2 },
          { slug: 'jamf-mobile-assist-device-helper', title: 'Jamf Mobile Assist - Device Helper', navOrder: 3 },
          { slug: 'jamf-return-to-service', title: 'Jamf Return to Service', navOrder: 4 },
        ],
        children: [],
      },
      {
        id: 'ai-governance',
        label: 'AI Governance',
        navOrder: 8,
        guides: [
          {
            slug: 'ai-governance-enforcement-with-jamf-extender',
            title: 'AI Governance: Jamf Extender でカバレッジを拡張する',
            navOrder: 20,
          },
        ],
        children: [],
      },
    ],
    concepts: [
      { slug: 'apiutil', title: 'API Utility' },
      { slug: 'app-scoper', title: 'AppScoper' },
      { slug: 'ddm-explorer', title: 'DDM Explorer' },
      { slug: 'jamf-actions', title: 'Jamf Actions' },
      { slug: 'jamf-cli', title: 'Jamf CLI' },
      { slug: 'jamf-compliance-editor', title: 'Jamf Compliance Editor' },
      { slug: 'jamf-connect-resources', title: 'Jamf Connect リソース' },
      { slug: 'jamf-device-checker', title: 'Jamf Device Checker' },
      { slug: 'jamf-extender', title: 'Jamf Extender' },
      { slug: 'mcp-hub', title: 'Jamf MCP Hub' },
      { slug: 'jamf-mobile-assist', title: 'Jamf Mobile Assist' },
      { slug: 'jamfplatform-go-sdk', title: 'Jamf Platform Go SDK' },
      { slug: 'jamf-printer-manager', title: 'Jamf Printer Manager' },
      { slug: 'jamfprotect-go-sdk', title: 'Jamf Protect Go SDK' },
      { slug: 'jamf-protect-resources', title: 'Jamf Protect Resources' },
      { slug: 'jamf-return-to-service', title: 'Jamf Return to Service' },
      { slug: 'jamf-status', title: 'Jamf Status' },
      { slug: 'jamf-sync', title: 'Jamf Sync' },
      { slug: 'jamfcheck', title: 'JamfCheck' },
      { slug: 'jamformer', title: 'jamformer' },
      { slug: 'jawa', title: 'JAWA' },
      { slug: 'mut', title: 'Mass Update Tool (MUT)' },
      { slug: 'orchard-view', title: 'Orchard View' },
      { slug: 'pppc-utility', title: 'PPPC Utility' },
      { slug: 'psso-utility', title: 'PSSO Utility' },
      { slug: 'mcp-rapidid', title: 'RapidID MCP Server' },
      { slug: 'reenroller', title: 'ReEnroller' },
      { slug: 'remediasoar', title: 'RemediaSOAR' },
      { slug: 'replicator', title: 'Replicator' },
      { slug: 'saastenancy', title: 'SaaSTenancy' },
      { slug: 'setup-manager', title: 'Setup Manager' },
      { slug: 'terraform-provider-jamfautoupdate', title: 'Terraform Provider — Jamf Auto Update' },
      { slug: 'terraform-provider-jamfplatform', title: 'Terraform Provider — Jamf Platform' },
      { slug: 'terraform-provider-jamfprotect', title: 'Terraform Provider — Jamf Protect' },
      { slug: 'terraform-provider-jsctfprovider', title: 'Terraform Provider — Jamf Security Cloud' },
      { slug: 'wallpaper-designer', title: 'ウォールペーパーデザイナー' },
      { slug: 'simple-network-relay', title: 'シンプルネットワークリレー' },
      { slug: 'setup-checklist', title: 'セットアップチェックリスト' },
    ],
  },
  fr: {
    guideCategoryLabels: {
      'device-trust-identity-and-deployment': 'Confiance des appareils, identité et déploiement',
      'android-enterprise': 'Android Enterprise',
      byod: 'BYOD',
      'platform-single-sign-on': 'Platform SSO pour macOS',
      'examples-and-demos': 'Exemples et démos',
      'getting-started-with-jamf-for-mac': 'Premiers pas avec Jamf pour Mac',
      'infrastructure-as-code': 'Infrastructure as Code',
      'resource-access-control': 'Contrôle d\'accès aux ressources',
      'threat-and-risk-management': 'Gestion des menaces et des risques',
      ai: 'IA',
      'data-loss-protection': 'Protection contre la perte de données',
    },
    guide: { slug: 'overview', path: 'overview', title: 'Aperçu' },
    nav: [
      {
        id: 'device-trust-identity-and-deployment',
        label: 'Device Trust Identity and Deployment',
        navOrder: 1,
        guides: [],
        children: [
          {
            id: 'android-enterprise',
            label: 'Android Enterprise',
            navOrder: 1,
            guides: [
              { slug: 'android-fully-managed', title: 'Appareils Android Entièrement Gérés', navOrder: 2 },
              {
                slug: 'work-profile-for-mixed-used-company-owned-devices',
                title: 'Profil professionnel pour appareils d\'entreprise à usage mixte',
                navOrder: 3,
              },
            ],
            children: [],
          },
          {
            id: 'byod',
            label: 'BYOD',
            navOrder: 2,
            guides: [
              {
                slug: 'android-work-profile-for-employee-owned-devices',
                title: 'Profil professionnel pour les appareils personnels des employés',
                navOrder: 1,
              },
              { slug: 'user-only-enrollments', title: 'Inscriptions réservées aux utilisateurs', navOrder: 3 },
            ],
            children: [{ id: 'android-enterprise-1', label: 'Android Enterprise', navOrder: 1, guides: [], children: [] }],
          },
          {
            id: 'platform-single-sign-on',
            label: 'Platform Single Sign-On',
            navOrder: 3,
            guides: [
              { slug: 'platform-sso-for-macos', title: 'Platform SSO pour macOS', navOrder: 2 },
              {
                slug: 'psso-jamfpro-okta',
                title: 'Configuration de la Simplified Setup pour Platform SSO à l\'aide de Jamf Pro et Okta',
                navOrder: 3,
              },
              { slug: 'jnuc-2025-sessions', title: 'Ressources vidéo et sessions', navOrder: 4 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'examples-and-demos',
        label: 'Examples and Demos',
        navOrder: 2,
        guides: [
          { slug: 'macos-corporate-owned-laptop', title: 'Mac d\'entreprise', navOrder: 2 },
          { slug: 'ios-corporate-owned-device', title: 'iPhone d\'entreprise', navOrder: 3 },
          { slug: 'ios-personally-owned-device', title: 'iPhone personnel (BYOD)', navOrder: 4 },
          { slug: 'unmanaged-vision-pro', title: 'Vision Pro non gérée', navOrder: 5 },
          { slug: 'corporate-owned-android-demo-video', title: 'Android d\'Entreprise', navOrder: 6 },
          { slug: 'personally-owned-android', title: 'Android personnel (BYOD)', navOrder: 7 },
        ],
        children: [],
      },
      { id: 'getting-started-with-jamf-for-mac', label: 'Jamf for Mac', navOrder: 3, guides: [], children: [] },
      {
        id: 'infrastructure-as-code',
        label: 'Infrastructure As Code',
        navOrder: 4,
        guides: [
          {
            slug: 'resources-for-getting-started-with-terraform-and-jamf',
            title: 'Ressources : Terraform, GitHub et configurations Jamf',
            navOrder: 1,
          },
          {
            slug: 'managing-jamf-pro-with-terraform-the-jamf-pro-provider',
            title: 'Introduction to Managing Jamf Configurations with Terraform',
            navOrder: 4,
          },
          {
            slug: 'managing-jamf-protect-with-terraform-the-jamf-protect-provider',
            title: 'Gérer Jamf Protect avec Terraform : Le fournisseur Jamf Protect',
            navOrder: 5,
          },
          {
            slug: 'managing-the-jamf-platform-with-terraform-the-jamf-platform-provider',
            title: 'Gérer la plateforme Jamf avec Terraform : le fournisseur Jamf Platform',
            navOrder: 6,
          },
          {
            slug: 'adopting-terraform-for-jamf-with-jamformer',
            title: 'Adopter Terraform pour Jamf avec jamformer',
            navOrder: 7,
          },
        ],
        children: [],
      },
      {
        id: 'it-workflows',
        label: 'IT Workflows',
        navOrder: 5,
        guides: [],
        children: [
          {
            id: 'form-to-wipe',
            label: 'Form to Wipe',
            navOrder: 1,
            guides: [
              { slug: 'n8n', title: 'Form to Wipe — Déploiement n8n', navOrder: 10 },
              { slug: 'github-actions', title: 'Form to Wipe — Déploiement GitHub Actions', navOrder: 30 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'resource-access-control',
        label: 'Resource Access Control',
        navOrder: 6,
        guides: [
          { slug: 'protecting-your-mdm-management-plane', title: 'Protéger votre plan de gestion MDM', navOrder: 1 },
          {
            slug: 'app-and-infrastructure-cloaking',
            title: 'Masquage des applications et de l\'infrastructure',
            navOrder: 2,
          },
          {
            slug: 'securing-self-hosted-llm-access-with-trusted-egress-ips',
            title: 'Sécurisation de l\'accès aux LLM avec des adresses IP de sortie fiables',
            navOrder: 3,
          },
          {
            slug: 'enabling-access-for-trusted-devices',
            title: 'Activation de l\'accès pour les appareils de confiance',
            navOrder: 4,
          },
          {
            slug: 'access-restriction-strategies',
            title: 'Restriction de l\'accès pour les appareils anonymes',
            navOrder: 6,
          },
          {
            slug: 'attested-device-compliance-for-microsoft-entra',
            title: 'Conformité des appareils attestés pour Microsoft Entra',
            navOrder: 7,
          },
          {
            slug: 'network-engineers-guide-to-private-access',
            title: 'Guide de l\'ingénieur réseau pour Jamf Connect ZTNA',
            navOrder: 15,
          },
        ],
        children: [],
      },
      {
        id: 'threat-and-risk-management',
        label: 'Threat and Risk Management',
        navOrder: 7,
        guides: [
          {
            slug: 'enforcing-compliance-baselines-for-network-access',
            title: 'Application des lignes directrices de conformité pour l\'accès réseau',
            navOrder: 3,
          },
          {
            slug: 'establishing-compliance-baselines',
            title: 'Établir des bases de conformité avec l\'Éditeur de conformité',
            navOrder: 5,
          },
          {
            slug: 'build-reports-for-jamf-pro-compliance-benchmarks',
            title: 'Créer des rapports pour les benchmarks de conformité Jamf Pro',
            navOrder: 6,
          },
          { slug: 'siem-xdr-integration', title: 'Intégration SIEM et XDR', navOrder: 9 },
        ],
        children: [
          {
            id: 'ai',
            label: 'AI',
            navOrder: 1,
            guides: [
              {
                slug: 'detecting-blocking-remediating-openclaw-using-jamf',
                title: 'Détection, blocage et correction d\'OpenClaw avec Jamf',
                navOrder: 1,
              },
            ],
            children: [],
          },
          {
            id: 'data-loss-protection',
            label: 'Data Loss Protection',
            navOrder: 2,
            guides: [
              { slug: 'dlp-deep-packet-inspection', title: 'Inspection approfondie des paquets', navOrder: 2 },
              { slug: 'saas-tenancy-control', title: 'Contrôle de la location SaaS', navOrder: 3 },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'jamf-for-mobile',
        label: 'Jamf for Mobile',
        navOrder: 8,
        guides: [
          { slug: 'jamf-device-checker', title: 'Jamf Device Checker', navOrder: 1 },
          { slug: 'jamf-mobile-assist-assigner', title: 'Jamf Mobile Assist - Assigner', navOrder: 2 },
          { slug: 'jamf-mobile-assist-device-helper', title: 'Jamf Mobile Assist - Device Helper', navOrder: 3 },
          { slug: 'jamf-return-to-service', title: 'Jamf Return to Service', navOrder: 4 },
        ],
        children: [],
      },
      {
        id: 'ai-governance',
        label: 'AI Governance',
        navOrder: 8,
        guides: [
          {
            slug: 'ai-governance-enforcement-with-jamf-extender',
            title: 'AI Governance : étendre la couverture avec Jamf Extender',
            navOrder: 20,
          },
        ],
        children: [],
      },
    ],
    concepts: [
      { slug: 'apiutil', title: 'API Utility' },
      { slug: 'app-scoper', title: 'AppScoper' },
      { slug: 'wallpaper-designer', title: 'Concepteur de fond d\'écran' },
      { slug: 'ddm-explorer', title: 'DDM Explorer' },
      { slug: 'terraform-provider-jamfautoupdate', title: 'Fournisseur Terraform — Jamf Auto Update' },
      { slug: 'terraform-provider-jamfprotect', title: 'Fournisseur Terraform — Jamf Protect' },
      { slug: 'jamf-actions', title: 'Jamf Actions' },
      { slug: 'jamf-cli', title: 'Jamf CLI' },
      { slug: 'jamf-compliance-editor', title: 'Jamf Compliance Editor' },
      { slug: 'jamf-device-checker', title: 'Jamf Device Checker' },
      { slug: 'jamf-extender', title: 'Jamf Extender' },
      { slug: 'mcp-hub', title: 'Jamf MCP Hub' },
      { slug: 'jamf-mobile-assist', title: 'Jamf Mobile Assist' },
      { slug: 'jamfplatform-go-sdk', title: 'Jamf Platform Go SDK' },
      { slug: 'jamf-printer-manager', title: 'Jamf Printer Manager' },
      { slug: 'jamfprotect-go-sdk', title: 'Jamf Protect Go SDK' },
      { slug: 'jamf-return-to-service', title: 'Jamf Return to Service' },
      { slug: 'jamf-status', title: 'Jamf Status' },
      { slug: 'jamf-sync', title: 'Jamf Sync' },
      { slug: 'jamfcheck', title: 'JamfCheck' },
      { slug: 'jamformer', title: 'jamformer' },
      { slug: 'jawa', title: 'JAWA' },
      { slug: 'setup-checklist', title: 'Liste de contrôle de configuration' },
      { slug: 'orchard-view', title: 'Orchard View' },
      { slug: 'mut', title: 'Outil de mise à jour en masse (MUT)' },
      { slug: 'pppc-utility', title: 'PPPC Utility' },
      { slug: 'psso-utility', title: 'PSSO Utility' },
      { slug: 'mcp-rapidid', title: 'RapidID MCP Server' },
      { slug: 'reenroller', title: 'ReEnroller' },
      { slug: 'remediasoar', title: 'RemediaSOAR' },
      { slug: 'replicator', title: 'Replicator' },
      { slug: 'jamf-connect-resources', title: 'Ressources Jamf Connect' },
      { slug: 'jamf-protect-resources', title: 'Ressources Jamf Protect' },
      { slug: 'saastenancy', title: 'SaaSTenancy' },
      { slug: 'setup-manager', title: 'Setup Manager' },
      { slug: 'simple-network-relay', title: 'Simple Network Relay' },
      { slug: 'terraform-provider-jamfplatform', title: 'Terraform Provider — Jamf Platform' },
      { slug: 'terraform-provider-jsctfprovider', title: 'Terraform Provider — Jamf Security Cloud' },
    ],
  },
};
