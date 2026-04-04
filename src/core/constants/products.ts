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
    searchLabel: 'product-routines',
    latestVersion: 'current',
    versions: ['current']
  },
  'self-service-plus': {
    id: 'self-service-plus',
    name: 'Self Service+',
    description: 'Next-generation self-service portal for macOS',
    bundleId: 'self-service-plus-documentation',
    searchLabel: 'product-self-service',
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
  }
} as const;

export type ProductId = keyof typeof JAMF_PRODUCTS;

// Derived ID array (shared by schemas, completions, etc.)
export const PRODUCT_IDS = Object.keys(JAMF_PRODUCTS) as [string, ...string[]];
