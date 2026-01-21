/**
 * Constants for Jamf Docs MCP Server
 *
 * Note: Jamf documentation has moved from docs.jamf.com to learn.jamf.com
 * The new URL structure is: learn.jamf.com/en-US/bundle/{product}-documentation/page/{page}.html
 */

// Environment variable helpers
const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const getEnvString = (key: string, defaultValue: string): string => {
  return process.env[key] ?? defaultValue;
};

// Base URLs
export const DOCS_BASE_URL = 'https://learn.jamf.com';
export const LEARN_BASE_URL = 'https://learn.jamf.com';
export const DOCS_API_URL = 'https://learn-be.jamf.com';

// Supported products - updated URL patterns for learn.jamf.com
export const JAMF_PRODUCTS = {
  'jamf-pro': {
    id: 'jamf-pro',
    name: 'Jamf Pro',
    description: 'Apple device management for enterprise',
    urlPattern: 'en-US/bundle/jamf-pro-documentation/page',
    bundleId: 'jamf-pro-documentation',
    searchLabel: 'product-pro',  // Label used in Zoomin search API
    latestVersion: 'current',
    versions: ['current']  // learn.jamf.com uses latest version only
  },
  'jamf-school': {
    id: 'jamf-school',
    name: 'Jamf School',
    description: 'Apple device management for education',
    urlPattern: 'en-US/bundle/jamf-school-documentation/page',
    bundleId: 'jamf-school-documentation',
    searchLabel: 'product-school',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-connect': {
    id: 'jamf-connect',
    name: 'Jamf Connect',
    description: 'Identity and access management',
    urlPattern: 'en-US/bundle/jamf-connect-documentation/page',
    bundleId: 'jamf-connect-documentation',
    searchLabel: 'product-connect',
    latestVersion: 'current',
    versions: ['current']
  },
  'jamf-protect': {
    id: 'jamf-protect',
    name: 'Jamf Protect',
    description: 'Endpoint security for Apple',
    urlPattern: 'en-US/bundle/jamf-protect-documentation/page',
    bundleId: 'jamf-protect-documentation',
    searchLabel: 'product-protect',
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

// Cache settings (in milliseconds) - configurable via environment variables
export const CACHE_TTL = {
  SEARCH_RESULTS: getEnvNumber('CACHE_TTL_SEARCH', 30 * 60 * 1000),      // 30 minutes
  ARTICLE_CONTENT: getEnvNumber('CACHE_TTL_ARTICLE', 24 * 60 * 60 * 1000), // 24 hours
  PRODUCT_LIST: getEnvNumber('CACHE_TTL_PRODUCTS', 7 * 24 * 60 * 60 * 1000), // 7 days
  TOC: getEnvNumber('CACHE_TTL_TOC', 24 * 60 * 60 * 1000)              // 24 hours
} as const;

// Cache directory - configurable via environment variable
export const CACHE_DIR = getEnvString('CACHE_DIR', '.cache');

// Request settings - configurable via environment variables
export const REQUEST_CONFIG = {
  TIMEOUT: getEnvNumber('REQUEST_TIMEOUT', 15000),                       // 15 seconds
  MAX_RETRIES: getEnvNumber('MAX_RETRIES', 3),
  RETRY_DELAY: getEnvNumber('RETRY_DELAY', 1000),                    // 1 second
  RATE_LIMIT_DELAY: getEnvNumber('RATE_LIMIT_DELAY', 500),                // 500ms between requests
  USER_AGENT: getEnvString('USER_AGENT', 'JamfDocsMCP/1.0 (https://github.com/GET-Technology-Inc/jamf-docs-mcp-server)')
} as const;

// Content limits
export const CONTENT_LIMITS = {
  MAX_SEARCH_RESULTS: 50,
  DEFAULT_SEARCH_RESULTS: 10,
  MAX_CONTENT_LENGTH: 100000,           // 100KB
  MAX_SNIPPET_LENGTH: 500
} as const;

// Token configuration (Context7 style)
export const TOKEN_CONFIG = {
  DEFAULT_MAX_TOKENS: 5000,
  MAX_TOKENS_LIMIT: 20000,
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
