/**
 * Product constants, base URLs, and URL helpers for Jamf documentation
 */

// Server icon (32x32 PNG, document theme, base64 data URI)
export const SERVER_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiUlEQVR4nGNgGAU4QEpKxX9qYpItpwSA9N+58wyOSXYENR0AYw+IA9AdQr4DehgQmEgHYIsGujuA7IRIqQNwOYp8B1ABUOQAOat4svDwcQA1wNB2ACVBPzwcQA0wtB0w4NlwwB1ADTC0HUBu1hs+DqAGGNoOAAbxCVLx8HIANQBZvaMB65qNKAAA5fafYXNsHh0AAAAASUVORK5CYII=';

// Base URLs
export const DOCS_BASE_URL = 'https://learn.jamf.com';
// Fluid Topics API (learn.jamf.com hosts FT 5.x)
export const FT_API_BASE = DOCS_BASE_URL;

/**
 * Build a full documentation URL with locale
 */
export function buildDocUrl(locale: string, bundleId: string, page: string): string {
  return `${DOCS_BASE_URL}/${locale}/bundle/${bundleId}/page/${page}`;
}

/**
 * Build a URL pattern path (without base URL) for a given locale and bundleId
 */
export function buildUrlPattern(locale: string, bundleId: string): string {
  return `${locale}/bundle/${bundleId}/page`;
}

// Supported products - updated URL patterns for learn.jamf.com
export const JAMF_PRODUCTS = {
  'jamf-pro': {
    id: 'jamf-pro',
    name: 'Jamf Pro',
    description: 'Apple device management for enterprise',
    bundleId: 'jamf-pro-documentation',
    searchLabel: 'product-pro',  // Legacy metadata label for FT search filter
    latestVersion: 'current',
    versions: ['current']  // learn.jamf.com uses latest version only
  },
  'jamf-school': {
    id: 'jamf-school',
    name: 'Jamf School',
    description: 'Apple device management for education',
    bundleId: 'jamf-school-documentation',
    searchLabel: 'product-school',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-connect': {
    id: 'jamf-connect',
    name: 'Jamf Connect',
    description: 'Identity and access management',
    bundleId: 'jamf-connect-documentation',
    searchLabel: 'product-connect',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-protect': {
    id: 'jamf-protect',
    name: 'Jamf Protect',
    description: 'Endpoint security for Apple',
    bundleId: 'jamf-protect-documentation',
    searchLabel: 'product-protect',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-now': {
    id: 'jamf-now',
    name: 'Jamf Now',
    description: 'Simple Apple device management for small businesses',
    bundleId: 'jamf-now-documentation',
    searchLabel: 'product-now',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-safe-internet': {
    id: 'jamf-safe-internet',
    name: 'Jamf Safe Internet',
    description: 'Content filtering and web security for education and business',
    bundleId: 'jamf-safe-internet-documentation',
    searchLabel: 'product-safeinternet',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-insights': {
    id: 'jamf-insights',
    name: 'Jamf Insights',
    description: 'Analytics and reporting platform for Apple fleet',
    bundleId: 'jamf-insights-documentation',
    searchLabel: 'product-insights',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-rapididentity': {
    id: 'jamf-rapididentity',
    name: 'RapidIdentity',
    description: 'Identity and access management platform',
    bundleId: 'jamf-rapididentity-documentation',
    searchLabel: 'product-rapididentity',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-trust': {
    id: 'jamf-trust',
    name: 'Jamf Trust',
    description: 'Zero-trust network access for Apple devices',
    bundleId: 'jamf-trust-documentation',
    searchLabel: 'product-trust',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-routines': {
    id: 'jamf-routines',
    name: 'Jamf Routines',
    description: 'Automated workflow orchestration for device management',
    bundleId: 'jamf-routines-documentation',
    // NOTE: Jamf tags the "Jamf Routines Documentation" map with zoominmetadata
    // `product-pro` (not `product-routines`), so product-filtered SEARCH for
    // jamf-routines returns 0 results. TOC/article fetch still work via the
    // bundle. This searchLabel is kept for forward-compat and is explicitly
    // allow-listed in the searchLabel contract test (see data-contracts.test.ts).
    searchLabel: 'product-routines',
    latestVersion: 'current',
    versions: ['current']
  },
  'self-service-plus': {
    id: 'self-service-plus',
    name: 'Self Service+',
    description: 'Next-generation self-service portal for macOS and mobile',
    bundleId: 'self-service-plus-documentation',
    // NOT `product-self-service`. Both labels exist in Jamf's zoominmetadata
    // vocabulary, and the hyphenated one belongs to the retired iOS Self
    // Service app: it matched 16 topics, every one of them from "Jamf Self
    // Service for iOS Release Notes". `product-selfservice` is the Self
    // Service+ label — 69 topics across "Self Service+ for macOS Deployment
    // Guide" (55) and "Self Service+ for Mobile Deployment Guide" (14). The
    // wrong label returned results rather than an error, so the mismatch was
    // invisible; the contract test below now pins the map titles.
    searchLabel: 'product-selfservice',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-app-catalog': {
    id: 'jamf-app-catalog',
    name: 'Jamf App Catalog',
    description: 'Curated application catalog for managed deployments',
    bundleId: 'jamf-app-catalog',
    searchLabel: 'product-appcatalog',
    latestVersion: 'current',
    versions: ['current']
  },

  // ─── Registered from Jamf's own classification ──────────────────────
  //
  // Every row below names something Jamf itself files under `jamf:portal`,
  // `jamf:app` or `jamf:utility` in the map metadata, and carries a
  // `product-*` label whose maps are 100% that entity's. Those two
  // conditions are the test: an entity Jamf does not name is not a product,
  // and a label that spans entities cannot be a search filter.
  //
  // Deliberately absent: FusionID and Manager for Android. Jamf names both
  // as portals but tags their maps with no `product-*` label at all, so a
  // `product` filter for them would match nothing. They are reachable as
  // publications `fluidid-documentation` and `manager-for-android-documentation`.
  'jamf-account': {
    // `product-account` also tags the AI Governance guide and two training
    // video sets. All four are Jamf Account documentation, so one product
    // whose search returns all of them is the honest shape; the other three
    // remain individually browsable on the publication axis.
    id: 'jamf-account',
    name: 'Jamf Account',
    description: 'Identity, licensing, and platform services portal',
    bundleId: 'jamf-account-documentation',
    searchLabel: 'product-account',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-security-cloud': {
    id: 'jamf-security-cloud',
    name: 'Jamf Security Cloud',
    description: 'Cloud security portal for Jamf Connect and Jamf Protect',
    bundleId: 'jamf-security-cloud-setup-guide',
    searchLabel: 'product-security',
    latestVersion: 'current',
    versions: ['current']
  },
  'elevate': {
    id: 'elevate',
    name: 'Elevate',
    description: 'Guided remediation and device health portal',
    bundleId: 'elevate-documentation',
    searchLabel: 'product-elevate',
    latestVersion: 'current',
    versions: ['current']
  },
  'composer': {
    id: 'composer',
    name: 'Composer',
    description: 'macOS package building and editing',
    bundleId: 'composer-user-guide',
    searchLabel: 'product-composer',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-parent': {
    // `bundleId` is the administrator-facing configuration guide, which is
    // what a Jamf admin asking for "the Jamf Parent docs" wants. The
    // parent-facing guide is the same product's other publication - 11
    // locales, the widest in the whole library and the only source of th-TH -
    // and stays reachable as publication `jamf-parent-guide-for-parents`.
    // `product-parent` covers both, so search spans them either way.
    id: 'jamf-parent',
    name: 'Jamf Parent',
    description: 'Parental device controls for school-issued devices',
    bundleId: 'jamf-parent-configuration-guide',
    searchLabel: 'product-parent',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-teacher': {
    // Same split as jamf-parent: admin guide here, `jamf-teacher-guide-for-teachers`
    // on the publication axis.
    id: 'jamf-teacher',
    name: 'Jamf Teacher',
    description: 'Classroom device management for teachers',
    bundleId: 'jamf-teacher-configuration-guide',
    searchLabel: 'product-teacher',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-setup-reset': {
    // Two Jamf apps documented in one guide. `product-setup` and
    // `product-reset` select the identical six maps, so either works as the
    // filter and a second product row would only duplicate this one -
    // and would collide on `bundleId`, which the registry invariants forbid.
    id: 'jamf-setup-reset',
    name: 'Jamf Setup and Reset',
    description: 'Device personalisation and wipe-and-reprovision apps',
    bundleId: 'jamf-setup-reset-configuration-guide',
    searchLabel: 'product-setup',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-assessment': {
    id: 'jamf-assessment',
    name: 'Jamf Assessment',
    description: 'Locked-down assessment mode for education devices',
    bundleId: 'jamf-assessment-configuration-guide',
    searchLabel: 'product-assessment',
    latestVersion: 'current',
    versions: ['current']
  },
  'title-editor': {
    id: 'title-editor',
    name: 'Title Editor',
    description: 'Custom software title patch definitions',
    bundleId: 'title-editor',
    searchLabel: 'product-titleeditor',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-infrastructure-manager': {
    id: 'jamf-infrastructure-manager',
    name: 'Jamf Infrastructure Manager',
    description: 'On-premises proxy for LDAP and other internal services',
    bundleId: 'jamf-infrastructure-manager-ldap-proxy-install-guide',
    searchLabel: 'product-infrastructuremanager',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-adcs-connector': {
    id: 'jamf-adcs-connector',
    name: 'Jamf AD CS Connector',
    description: 'Certificate issuance via Active Directory Certificate Services',
    bundleId: 'technical-paper-integrating-ad-cs',
    searchLabel: 'product-adcsconnector',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-pki-proxy': {
    id: 'jamf-pki-proxy',
    name: 'Jamf PKI Proxy',
    description: 'Proxy for certificate authorities behind a firewall',
    bundleId: 'jamf-pki-proxy-install-guide',
    searchLabel: 'product-pki-proxy',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-migrate': {
    id: 'jamf-migrate',
    name: 'Jamf Migrate',
    description: 'Migrating macOS devices between Jamf Pro instances',
    bundleId: 'jamf-migrate-user-guide',
    searchLabel: 'product-migrate',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-remote-assist': {
    id: 'jamf-remote-assist',
    name: 'Jamf Remote Assist',
    description: 'Remote screen sharing and support sessions',
    bundleId: 'jamf-remote-assist-release-notes',
    searchLabel: 'product-remote-assist',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-cloud-distribution-service': {
    id: 'jamf-cloud-distribution-service',
    name: 'Jamf Cloud Distribution Service',
    description: 'Jamf-hosted package distribution (JCDS)',
    bundleId: 'jamf-cloud-distribution-service-release-notes',
    searchLabel: 'product-jcds',
    latestVersion: 'current',
    versions: ['current']
  },
  'healthcare-listener': {
    id: 'healthcare-listener',
    name: 'Healthcare Listener',
    description: 'Integration with healthcare information systems',
    bundleId: 'healthcare-listener-install-guide',
    searchLabel: 'product-healthcarelistener',
    latestVersion: 'current',
    versions: ['current']
  }
} as const;

export type ProductId = keyof typeof JAMF_PRODUCTS;

// Derived ID array (shared by schemas, completions, etc.)
export const PRODUCT_IDS = Object.keys(JAMF_PRODUCTS) as [string, ...string[]];

/**
 * The product enum rendered for prose: tool descriptions, Zod `.describe()`
 * strings, and prompt argument hints.
 *
 * Derived from PRODUCT_IDS rather than written out. The hand-written lists it
 * replaces named only the four flagship products while `z.enum(PRODUCT_IDS)`
 * accepted every ID in JAMF_PRODUCTS, so a client that trusted the description
 * never passed `jamf-routines` or `jamf-trust` even though both work. The
 * `descriptions enumerate the whole product enum` test in
 * description-accuracy.test.ts fails if a description goes back to naming a
 * subset.
 */
export const PRODUCT_ID_LIST = PRODUCT_IDS.join(', ');
