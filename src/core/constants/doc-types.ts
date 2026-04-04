/**
 * Document type constants for filtering search results by content category
 */

// Document types for filtering search results by content category
// Each type maps to a legacy `content-*` label key used by the FT search filter
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
} as const;

export type DocTypeId = keyof typeof DOC_TYPES;

// Forward mapping: docType enum value -> API label key
export const DOC_TYPE_LABEL_MAP: Record<DocTypeId, string> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([id, dt]) => [id, dt.labelKey])
) as Record<DocTypeId, string>;

/**
 * Forward mapping: docType -> Fluid Topics `jamf:contentType` metadata value.
 *
 * Note: The FT API uses 'Technical Documentation' for multiple doc types
 * (documentation, training, solution-guide, getting-started), so reverse
 * lookup (contentType -> docType) will always return 'documentation' for
 * these entries. This is a known FT API limitation.
 */
export const DOC_TYPE_CONTENT_TYPE_MAP: Record<string, string> = {
  'documentation': 'Technical Documentation',
  'release-notes': 'Release Notes',
  'glossary': 'Glossary',
  'training': 'Technical Documentation',
  'solution-guide': 'Technical Documentation',
  'getting-started': 'Technical Documentation',
};

// Derived ID array (shared by schemas, completions, etc.)
export const DOC_TYPE_IDS = Object.keys(DOC_TYPES) as [string, ...string[]];
