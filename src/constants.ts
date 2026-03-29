/**
 * Constants for Jamf Docs MCP Server
 *
 * Note: Jamf documentation has moved from docs.jamf.com to learn.jamf.com
 * The new URL structure is: learn.jamf.com/{locale}/bundle/{product}-documentation/page/{page}.html
 */

import * as path from 'path';
import { createRequire } from 'module';

// Environment variable helpers
export function getEnvNumber(
  key: string,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  if (min !== undefined && parsed < min) {
    console.error(`[WARNING] ${key}=${parsed} is below minimum ${min}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  if (max !== undefined && parsed > max) {
    console.error(`[WARNING] ${key}=${parsed} exceeds maximum ${max}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  return parsed;
}

function getEnvString(key: string, defaultValue: string): string {
  const value = process.env[key] ?? defaultValue;
  // Strip CRLF characters to prevent HTTP header injection
  return value.replace(/[\r\n]/g, '');
}

// Server icon (32x32 PNG, document theme, base64 data URI)
export const SERVER_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiUlEQVR4nGNgGAU4QEpKxX9qYpItpwSA9N+58wyOSXYENR0AYw+IA9AdQr4DehgQmEgHYIsGujuA7IRIqQNwOYp8B1ABUOQAOat4svDwcQA1wNB2ACVBPzwcQA0wtB0w4NlwwB1ADTC0HUBu1hs+DqAGGNoOAAbxCVLx8HIANQBZvaMB65qNKAAA5fafYXNsHh0AAAAASUVORK5CYII=';

// Server metadata (auto-read from package.json)
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const SERVER_VERSION = pkg.version;

// Base URLs
export const DOCS_BASE_URL = 'https://learn.jamf.com';
export const DOCS_API_URL = 'https://learn-be.jamf.com';

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
    urlPattern: 'bundle/jamf-pro-documentation/page',
    bundleId: 'jamf-pro-documentation',
    searchLabel: 'product-pro',  // Label used in Zoomin search API
    latestVersion: 'current',
    versions: ['current']  // learn.jamf.com uses latest version only
  },
  'jamf-school': {
    id: 'jamf-school',
    name: 'Jamf School',
    description: 'Apple device management for education',
    urlPattern: 'bundle/jamf-school-documentation/page',
    bundleId: 'jamf-school-documentation',
    searchLabel: 'product-school',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-connect': {
    id: 'jamf-connect',
    name: 'Jamf Connect',
    description: 'Identity and access management',
    urlPattern: 'bundle/jamf-connect-documentation/page',
    bundleId: 'jamf-connect-documentation',
    searchLabel: 'product-connect',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-protect': {
    id: 'jamf-protect',
    name: 'Jamf Protect',
    description: 'Endpoint security for Apple',
    urlPattern: 'bundle/jamf-protect-documentation/page',
    bundleId: 'jamf-protect-documentation',
    searchLabel: 'product-protect',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-now': {
    id: 'jamf-now',
    name: 'Jamf Now',
    description: 'Simple Apple device management for small businesses',
    urlPattern: 'bundle/jamf-now-documentation/page',
    bundleId: 'jamf-now-documentation',
    searchLabel: 'product-now',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-safe-internet': {
    id: 'jamf-safe-internet',
    name: 'Jamf Safe Internet',
    description: 'Content filtering and web security for education and business',
    urlPattern: 'bundle/jamf-safe-internet-documentation/page',
    bundleId: 'jamf-safe-internet-documentation',
    searchLabel: 'product-safeinternet',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-insights': {
    id: 'jamf-insights',
    name: 'Jamf Insights',
    description: 'Analytics and reporting platform for Apple fleet',
    urlPattern: 'bundle/jamf-insights-documentation/page',
    bundleId: 'jamf-insights-documentation',
    searchLabel: 'product-insights',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-rapididentity': {
    id: 'jamf-rapididentity',
    name: 'RapidIdentity',
    description: 'Identity and access management platform',
    urlPattern: 'bundle/jamf-rapididentity-documentation/page',
    bundleId: 'jamf-rapididentity-documentation',
    searchLabel: 'product-rapididentity',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-trust': {
    id: 'jamf-trust',
    name: 'Jamf Trust',
    description: 'Zero-trust network access for Apple devices',
    urlPattern: 'bundle/jamf-trust-documentation/page',
    bundleId: 'jamf-trust-documentation',
    searchLabel: 'product-trust',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-routines': {
    id: 'jamf-routines',
    name: 'Jamf Routines',
    description: 'Automated workflow orchestration for device management',
    urlPattern: 'bundle/jamf-routines-documentation/page',
    bundleId: 'jamf-routines-documentation',
    searchLabel: 'product-routines',
    latestVersion: 'current',
    versions: ['current']
  },
  'self-service-plus': {
    id: 'self-service-plus',
    name: 'Self Service+',
    description: 'Next-generation self-service portal for macOS',
    urlPattern: 'bundle/self-service-plus-documentation/page',
    bundleId: 'self-service-plus-documentation',
    searchLabel: 'product-self-service',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-app-catalog': {
    id: 'jamf-app-catalog',
    name: 'Jamf App Catalog',
    description: 'Curated application catalog for managed deployments',
    urlPattern: 'bundle/jamf-app-catalog/page',
    bundleId: 'jamf-app-catalog',
    searchLabel: 'product-appcatalog',
    latestVersion: 'current',
    versions: ['current']
  }
} as const;

export type ProductId = keyof typeof JAMF_PRODUCTS;

// Response format
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

// Output mode (detail level)
export enum OutputMode {
  FULL = 'full',
  COMPACT = 'compact'
}

// Cache settings (in milliseconds) - configurable via environment variables
// Range: 1 minute to 30 days
const CACHE_TTL_MIN = 60_000;
const CACHE_TTL_MAX = 30 * 24 * 60 * 60 * 1000;

export const CACHE_TTL = {
  SEARCH_RESULTS: getEnvNumber('CACHE_TTL_SEARCH', 30 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
  ARTICLE_CONTENT: getEnvNumber('CACHE_TTL_ARTICLE', 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
  PRODUCT_LIST: getEnvNumber('CACHE_TTL_PRODUCTS', 7 * 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
  TOC: getEnvNumber('CACHE_TTL_TOC', 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX)
} as const;

// Cache memory limits
export const CACHE_MAX_ENTRIES = getEnvNumber('CACHE_MAX_ENTRIES', 500, 10, 10000);

// Cache directory - configurable via environment variable with path traversal protection
const DEFAULT_CACHE_DIR = '.cache';

// System-sensitive directory prefixes that should not be used as cache directories
const SENSITIVE_DIR_PREFIXES = ['/etc', '/usr', '/var', '/sys', '/proc', '/dev', '/sbin', '/bin'];

function getValidatedCacheDir(): string {
  const raw = getEnvString('CACHE_DIR', DEFAULT_CACHE_DIR);
  const resolved = path.resolve(raw);
  const cwd = process.cwd();

  if (path.isAbsolute(raw)) {
    // Reject absolute paths pointing to system-sensitive directories
    const normalizedResolved = resolved.toLowerCase();
    for (const prefix of SENSITIVE_DIR_PREFIXES) {
      if (normalizedResolved === prefix || normalizedResolved.startsWith(`${prefix}/`)) {
        console.error(`[SECURITY WARNING] CACHE_DIR "${raw}" points to a sensitive system directory. Using default "${DEFAULT_CACHE_DIR}".`);
        return DEFAULT_CACHE_DIR;
      }
    }
  } else {
    // Relative paths must resolve within cwd
    if (!resolved.startsWith(cwd)) {
      console.error(`[SECURITY WARNING] CACHE_DIR "${raw}" resolves outside project directory. Using default "${DEFAULT_CACHE_DIR}".`);
      return DEFAULT_CACHE_DIR;
    }
  }

  return raw;
}

export const CACHE_DIR = getValidatedCacheDir();

// Request settings - configurable via environment variables
export const REQUEST_CONFIG = {
  TIMEOUT: getEnvNumber('REQUEST_TIMEOUT', 15000, 1000, 60000),          // 15s (1s-60s)
  MAX_RETRIES: getEnvNumber('MAX_RETRIES', 3, 0, 10),                   // 3 (0-10)
  RETRY_DELAY: getEnvNumber('RETRY_DELAY', 1000, 100, 30000),           // 1s (100ms-30s)
  RATE_LIMIT_DELAY: getEnvNumber('RATE_LIMIT_DELAY', 500, 0, 10000),    // 500ms (0-10s)
  USER_AGENT: getEnvString('USER_AGENT', 'JamfDocsMCP/1.0 (https://github.com/GET-Technology-Inc/jamf-docs-mcp-server)')
} as const;

// Content limits
export const CONTENT_LIMITS = {
  MAX_SEARCH_RESULTS: 50,
  DEFAULT_SEARCH_RESULTS: 10,
  FILTER_OVERFETCH_MULTIPLIER: 3,       // fetch 3× when client-side filters need post-filtering
  FILTER_OVERFETCH_CAP: 150,            // absolute cap on over-fetched results
  MAX_CONTENT_LENGTH: 100000,           // 100KB
  MAX_SNIPPET_LENGTH: 500
} as const;

// Token configuration (Context7 style)
export const TOKEN_CONFIG = {
  DEFAULT_MAX_TOKENS: 5000,
  MAX_TOKENS_LIMIT: 50000,
  MIN_TOKENS: 100,
  CHARS_PER_TOKEN: 4,  // Estimation ratio
  CODE_CHARS_PER_TOKEN: 3  // Code blocks have higher token density
} as const;

// Pagination configuration
export const PAGINATION_CONFIG = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE: 100
} as const;

// Topic categories for filtering (comprehensive list based on actual Jamf documentation)
export const JAMF_TOPICS = {
  // === Enrollment & Onboarding ===
  'enrollment': {
    name: 'Enrollment & Onboarding',
    keywords: ['enroll', 'dep', 'ade', 'automated device enrollment', 'user enrollment', 'apple configurator', 'onboard', 'prestage', 'enrollment method']
  },

  // === Device Management ===
  'computer-management': {
    name: 'Computer Management',
    keywords: ['computer management', 'computer inventory', 'remote command', 'remote administration', 'mass action', 'unmanag', 'check-in', 'startup script', 'login event']
  },
  'mobile-management': {
    name: 'Mobile Device Management',
    keywords: ['mobile device', 'iphone', 'ipad', 'ios', 'ipados', 'mobile inventory', 'mdm capabilities']
  },

  // === Configuration ===
  'profiles': {
    name: 'Configuration Profiles',
    keywords: ['configuration profile', 'profile', 'payload', 'restriction', 'settings management', 'computer configuration', 'mobile configuration']
  },
  'policies': {
    name: 'Policies',
    keywords: ['policy', 'policies', 'execution frequency', 'user interaction', 'policy management', 'policy payload', 'trigger']
  },

  // === Software & Packages ===
  'packages': {
    name: 'Packages & Deployment',
    keywords: ['package', 'pkg', 'dmg', 'package deployment', 'package management', 'installer']
  },
  'scripts': {
    name: 'Scripts',
    keywords: ['script', 'bash', 'shell', 'login script', 'startup script', 'extension attribute']
  },
  'patch': {
    name: 'Patch Management',
    keywords: ['patch', 'patch management', 'patch policy', 'software update', 'patch reporting', 'software title', 'patch source']
  },
  'apps': {
    name: 'App Management',
    keywords: ['app', 'application', 'app installer', 'vpp', 'volume purchase', 'managed app', 'app store', 'mac app store']
  },

  // === Self Service ===
  'self-service': {
    name: 'Self Service',
    keywords: ['self service', 'self-service', 'dock item', 'branding', 'bookmark', 'user portal']
  },

  // === Security ===
  'security': {
    name: 'Security Settings',
    keywords: ['security', 'security settings', 'restricted software', 'efi password', 'firmware password', 'gatekeeper']
  },
  'filevault': {
    name: 'FileVault & Encryption',
    keywords: ['filevault', 'encryption', 'recovery key', 'disk encryption', 'institutional recovery', 'personal recovery']
  },
  'compliance': {
    name: 'Compliance & Baseline',
    keywords: ['compliance', 'baseline', 'compliance baseline', 'security benchmark', 'cis benchmark', 'gdpr']
  },

  // === Endpoint Protection (Jamf Protect) ===
  'protect-analytics': {
    name: 'Threat Analytics',
    keywords: ['analytic', 'threat', 'detection', 'analytic chain', 'custom analytic', 'jamf-managed analytic', 'alert']
  },
  'protect-plans': {
    name: 'Protect Plans',
    keywords: ['protect plan', 'jamf protect plan', 'threat prevention', 'endpoint security']
  },
  'data-integration': {
    name: 'SIEM & Data Integration',
    keywords: ['siem', 'splunk', 'sentinel', 'elastic', 'datadog', 'sumo logic', 'google secops', 'amazon s3', 'data stream', 'data integration']
  },

  // === Identity & Authentication ===
  'sso': {
    name: 'Single Sign-On',
    keywords: ['sso', 'single sign-on', 'saml', 'oidc', 'oauth', 'jamf account', 'platform sso']
  },
  'ldap': {
    name: 'Directory Services',
    keywords: ['ldap', 'active directory', 'directory binding', 'open directory', 'google secure ldap']
  },
  'identity-provider': {
    name: 'Identity Providers',
    keywords: ['identity provider', 'idp', 'okta', 'azure ad', 'entra id', 'microsoft entra', 'google', 'cloud identity']
  },

  // === Jamf Connect ===
  'connect-login': {
    name: 'Jamf Connect Login',
    keywords: ['jamf connect', 'login window', 'local account', 'account creation', 'account migration', 'mobile account']
  },
  'connect-password': {
    name: 'Password & Keychain',
    keywords: ['password sync', 'keychain', 'password policy', 'local password']
  },
  'privilege-elevation': {
    name: 'Privilege Elevation',
    keywords: ['privilege elevation', 'admin rights', 'sudo', 'privilege', 'self service+']
  },

  // === Users & Accounts ===
  'users': {
    name: 'Users & Accounts',
    keywords: ['user account', 'local account', 'managed local administrator', 'mdm-enabled', 'user group', 'admin account']
  },
  'user-roles': {
    name: 'Roles & Permissions',
    keywords: ['user role', 'permission', 'privilege', 'administrator role', 'api role', 'access level']
  },

  // === Inventory & Reporting ===
  'inventory': {
    name: 'Inventory',
    keywords: ['inventory', 'inventory collection', 'inventory display', 'hardware inventory', 'software inventory', 'inventory preload']
  },
  'extension-attributes': {
    name: 'Extension Attributes',
    keywords: ['extension attribute', 'custom attribute', 'ea', 'custom field', 'inventory attribute']
  },
  'reports': {
    name: 'Reports & Searches',
    keywords: ['report', 'search', 'advanced search', 'simple search', 'smart group', 'criteria', 'computer report']
  },
  'history': {
    name: 'History & Logs',
    keywords: ['history', 'log', 'audit', 'audit log', 'computer history', 'management history', 'server log']
  },

  // === API & Integration ===
  'api': {
    name: 'API & Automation',
    keywords: ['api', 'rest api', 'classic api', 'jamf pro api', 'api role', 'api client', 'bearer token']
  },
  'graphql': {
    name: 'GraphQL API',
    keywords: ['graphql', 'query', 'mutation', 'schema', 'protect api']
  },
  'webhooks': {
    name: 'Webhooks & Notifications',
    keywords: ['webhook', 'notification', 'email notification', 'impact alert', 'event']
  },

  // === Network & Printing ===
  'network': {
    name: 'Network Configuration',
    keywords: ['wifi', 'vpn', 'network', 'proxy', 'firewall', 'port', 'ip address', 'url']
  },
  'certificates': {
    name: 'Certificates',
    keywords: ['certificate', 'ssl', 'scep', 'push certificate', 'apns', 'signing']
  },
  'printers': {
    name: 'Printers',
    keywords: ['printer', 'print', 'cups', 'ppd']
  },

  // === Remote Access ===
  'remote-access': {
    name: 'Remote Access',
    keywords: ['remote assist', 'jamf remote', 'teamviewer', 'screen sharing', 'vnc', 'remote administration']
  },

  // === Server Administration ===
  'server-admin': {
    name: 'Server Administration',
    keywords: ['server', 'jamf pro server', 'activation code', 'smtp', 'ssl certificate', 'maintenance', 'health check', 'clustering']
  },
  'change-management': {
    name: 'Change Management',
    keywords: ['change management', 'change log', 'version', 'backup', 'restore']
  },

  // === License Management ===
  'licensing': {
    name: 'License Management',
    keywords: ['license', 'licensed software', 'license compliance', 'license usage', 'vpp token']
  },

  // === Education (Jamf School) ===
  'education': {
    name: 'Education & Classroom',
    keywords: ['school', 'class', 'teacher', 'student', 'jamf teacher', 'jamf student', 'jamf parent', 'classroom', 'education']
  },
  'school-integration': {
    name: 'School Integrations',
    keywords: ['apple school manager', 'asm', 'shared ipad', 'location', 'google classroom']
  }
} as const;

export type TopicId = keyof typeof JAMF_TOPICS;

// Document types for filtering search results by content category
// Each type maps to a Zoomin API `content-*` label key
export const DOC_TYPES = {
  'documentation': {
    name: 'Documentation',
    description: 'Main product documentation',
    labelKey: 'content-techdocs',
  },
  'release-notes': {
    name: 'Release Notes',
    description: 'Version release notes and changelogs',
    labelKey: 'content-releasenotes',
  },
  'training': {
    name: 'Training',
    description: 'Training materials and video guides',
    labelKey: 'content-training',
  },
  'solution-guide': {
    name: 'Solution Guide',
    description: 'Solution guides and best practices',
    labelKey: 'content-solutionguide',
  },
  'glossary': {
    name: 'Glossary',
    description: 'Technical glossary and terminology',
    labelKey: 'content-glossary',
  },
  'getting-started': {
    name: 'Getting Started',
    description: 'Getting started guides and quickstart content',
    labelKey: 'content-gettingstarted',
  },
  'archive': {
    name: 'Archive',
    description: 'Archived documentation from previous versions',
    labelKey: 'content-archive',
  },
} as const;

// Forward mapping: docType enum value → API label key
export const DOC_TYPE_LABEL_MAP: Record<DocTypeId, string> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([id, dt]) => [id, dt.labelKey])
) as Record<DocTypeId, string>;

// Reverse mapping: API label key → docType enum value
export const LABEL_TO_DOC_TYPE: Record<string, DocTypeId> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([id, dt]) => [dt.labelKey, id])
) as Record<string, DocTypeId>;

export type DocTypeId = keyof typeof DOC_TYPES;

// Derived ID arrays (shared by schemas, completions, etc.)
export const PRODUCT_IDS = Object.keys(JAMF_PRODUCTS) as [string, ...string[]];
export const TOPIC_IDS = Object.keys(JAMF_TOPICS) as [string, ...string[]];
export const DOC_TYPE_IDS = Object.keys(DOC_TYPES) as [string, ...string[]];

// HTML selectors for learn.jamf.com (React-based site)
export const SELECTORS = {
  // Main content - learn.jamf.com uses semantic article tag
  CONTENT: 'article, .article-content, main article, #content',
  TITLE: 'h1',

  // Navigation - learn.jamf.com structure
  BREADCRUMB: '[class*="breadcrumb"] a, nav[aria-label="breadcrumb"] a',
  TOC: 'nav.related-links a, [class*="toc"] a, [class*="sidebar"] a',

  // Related content
  RELATED: 'nav.related-links a, .related-topics a, [class*="related"] a',

  // Elements to remove (scripts, tracking, etc.)
  REMOVE: 'script, style, noscript, footer, [id="initial-data"], [class*="cookie"], [class*="tracking"], [class*="analytics"]'
} as const;
