/**
 * Topic category constants for Jamf documentation filtering
 */

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

// Derived ID array (shared by schemas, completions, etc.)
export const TOPIC_IDS = Object.keys(JAMF_TOPICS) as [string, ...string[]];
