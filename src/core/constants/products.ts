/**
 * Product constants, base URLs, and URL helpers for Jamf documentation
 */

// Server icon (32x32 PNG, document theme, base64 data URI)
export const SERVER_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiUlEQVR4nGNgGAU4QEpKxX9qYpItpwSA9N+58wyOSXYENR0AYw+IA9AdQr4DehgQmEgHYIsGujuA7IRIqQNwOYp8B1ABUOQAOat4svDwcQA1wNB2ACVBPzwcQA0wtB0w4NlwwB1ADTC0HUBu1hs+DqAGGNoOAAbxCVLx8HIANQBZvaMB65qNKAAA5fafYXNsHh0AAAAASUVORK5CYII=';

// Base URLs
export const DOCS_BASE_URL = 'https://learn.jamf.com';
// Fluid Topics API (learn.jamf.com hosts FT 5.x)
export const FT_API_BASE = DOCS_BASE_URL;

// Supported products - updated URL patterns for learn.jamf.com
export const JAMF_PRODUCTS = {
  'jamf-pro': {
    id: 'jamf-pro',
    name: 'Jamf Pro',
    description: 'Apple device management for enterprise',
    bundleId: 'jamf-pro-documentation',
    latestVersion: 'current',
    versions: ['current']  // learn.jamf.com uses latest version only
  },
  'jamf-school': {
    id: 'jamf-school',
    name: 'Jamf School',
    description: 'Apple device management for education',
    bundleId: 'jamf-school-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-connect': {
    id: 'jamf-connect',
    name: 'Jamf Connect',
    description: 'Identity and access management',
    bundleId: 'jamf-connect-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-protect': {
    id: 'jamf-protect',
    name: 'Jamf Protect',
    description: 'Endpoint security for Apple',
    bundleId: 'jamf-protect-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-now': {
    id: 'jamf-now',
    name: 'Jamf Now',
    description: 'Simple Apple device management for small businesses',
    bundleId: 'jamf-now-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-safe-internet': {
    id: 'jamf-safe-internet',
    name: 'Jamf Safe Internet',
    description: 'Content filtering and web security for education and business',
    bundleId: 'jamf-safe-internet-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-insights': {
    id: 'jamf-insights',
    name: 'Jamf Insights',
    description: 'Analytics and reporting platform for Apple fleet',
    bundleId: 'jamf-insights-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-rapididentity': {
    id: 'jamf-rapididentity',
    name: 'RapidIdentity',
    description: 'Identity and access management platform',
    bundleId: 'jamf-rapididentity-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-trust': {
    id: 'jamf-trust',
    name: 'Jamf Trust',
    description: 'Zero-trust network access for Apple devices',
    bundleId: 'jamf-trust-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-routines': {
    id: 'jamf-routines',
    name: 'Jamf Routines',
    description: 'Automated workflow orchestration for device management',
    bundleId: 'jamf-routines-documentation',
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
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-app-catalog': {
    id: 'jamf-app-catalog',
    name: 'Jamf App Catalog',
    description: 'Curated application catalog for managed deployments',
    bundleId: 'jamf-app-catalog',
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
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-security-cloud': {
    id: 'jamf-security-cloud',
    name: 'Jamf Security Cloud',
    description: 'Cloud security portal for Jamf Connect and Jamf Protect',
    bundleId: 'jamf-security-cloud-setup-guide',
    latestVersion: 'current',
    versions: ['current']
  },
  'elevate': {
    id: 'elevate',
    name: 'Elevate',
    description: 'Guided remediation and device health portal',
    bundleId: 'elevate-documentation',
    latestVersion: 'current',
    versions: ['current']
  },
  'composer': {
    id: 'composer',
    name: 'Composer',
    description: 'macOS package building and editing',
    bundleId: 'composer-user-guide',
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
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-assessment': {
    id: 'jamf-assessment',
    name: 'Jamf Assessment',
    description: 'Locked-down assessment mode for education devices',
    bundleId: 'jamf-assessment-configuration-guide',
    latestVersion: 'current',
    versions: ['current']
  },
  'title-editor': {
    id: 'title-editor',
    name: 'Title Editor',
    description: 'Custom software title patch definitions',
    bundleId: 'title-editor',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-infrastructure-manager': {
    id: 'jamf-infrastructure-manager',
    name: 'Jamf Infrastructure Manager',
    description: 'On-premises proxy for LDAP and other internal services',
    bundleId: 'jamf-infrastructure-manager-ldap-proxy-install-guide',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-adcs-connector': {
    id: 'jamf-adcs-connector',
    name: 'Jamf AD CS Connector',
    description: 'Certificate issuance via Active Directory Certificate Services',
    bundleId: 'technical-paper-integrating-ad-cs',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-pki-proxy': {
    id: 'jamf-pki-proxy',
    name: 'Jamf PKI Proxy',
    description: 'Proxy for certificate authorities behind a firewall',
    bundleId: 'jamf-pki-proxy-install-guide',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-migrate': {
    id: 'jamf-migrate',
    name: 'Jamf Migrate',
    description: 'Migrating macOS devices between Jamf Pro instances',
    bundleId: 'jamf-migrate-user-guide',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-remote-assist': {
    id: 'jamf-remote-assist',
    name: 'Jamf Remote Assist',
    description: 'Remote screen sharing and support sessions',
    bundleId: 'jamf-remote-assist-release-notes',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-cloud-distribution-service': {
    id: 'jamf-cloud-distribution-service',
    name: 'Jamf Cloud Distribution Service',
    description: 'Jamf-hosted package distribution (JCDS)',
    bundleId: 'jamf-cloud-distribution-service-release-notes',
    latestVersion: 'current',
    versions: ['current']
  },
  'healthcare-listener': {
    id: 'healthcare-listener',
    name: 'Healthcare Listener',
    description: 'Integration with healthcare information systems',
    bundleId: 'healthcare-listener-install-guide',
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
 * `every description that enumerates product IDs names the whole enum` test
 * in description-accuracy.test.ts fails if a description goes back to naming
 * a subset.
 */
export const PRODUCT_ID_LIST = PRODUCT_IDS.join(', ');

/**
 * Products whose Jamf classification value is not simply their `name`.
 *
 * The `product` search filter used to carry a hand-written `searchLabel` per
 * product — a translation into `zoominmetadata`'s legacy Zoomin vocabulary
 * (`product-pro`, `product-selfservice`, `product-jcds`). That vocabulary is
 * not derivable from anything: measured live, 22 of 30 classification names
 * have several `product-*` labels co-occurring, three labels are irregular
 * spellings, and two classified products carry no `product-*` label at all.
 * So every row had to be maintained by hand, and Jamf re-tagging one map was
 * enough to turn the contract that guarded them red.
 *
 * `jamf:portal` / `jamf:app` / `jamf:utility` is Jamf's current vocabulary,
 * accepted by `clustered-search` as a filter key, and 26 of the 28 product
 * names appear in it verbatim — so those 26 need no table at all. Only these
 * two do:
 *
 * - `jamf-setup-reset` is one product ID over two `jamf:app` values, because
 *   Jamf files Setup and Reset separately. Filtering on either value or on
 *   both returns the same 6 maps (the two apps share one publication), so the
 *   pair is listed for accuracy rather than coverage.
 * - `jamf-routines` has no classification value at all, and an empty list
 *   here means "no product filter is possible". That is not a gap this table
 *   can close: measured 2026-09-18, NO Jamf Routines topic is in the
 *   clustered-search index under any query, filtered or not — searching its
 *   own name returns 0 of 999 results. Its `product-routines` label was never
 *   the cause; the content is simply not indexed. TOC and article fetch still
 *   work, because those address the bundle directly.
 */
const CLASSIFICATION_OVERRIDES: Partial<Record<string, readonly string[]>> = {
  'jamf-setup-reset': ['Jamf Setup', 'Jamf Reset'],
  'jamf-routines': [],
};

/**
 * Jamf's own classification values for a product — what the `product` search
 * filter sends upstream.
 *
 * Empty when Jamf names nothing by this product, in which case no product
 * filter can be built and the caller must say so rather than search unfiltered.
 */
export function classificationValuesFor(id: ProductId): readonly string[] {
  return CLASSIFICATION_OVERRIDES[id] ?? [JAMF_PRODUCTS[id].name];
}
