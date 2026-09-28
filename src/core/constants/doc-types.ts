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
 * Reverse mapping: Fluid Topics `content-*` label key -> docType id.
 *
 * FT publishes these under the `zoominmetadata` key on every topic, and the
 * vocabulary is exactly the {@link DOC_TYPES} labelKey set. That makes it —
 * not `jamf:contentType` — the authoritative answer to "what kind of document
 * is this", and unlike `jamf:contentType` it is not many-to-one.
 */
export const LABEL_KEY_DOC_TYPE_MAP: Record<string, DocTypeId> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([id, dt]) => [dt.labelKey, id])
) as Record<string, DocTypeId>;

/**
 * Order in which a topic's several `content-*` labels collapse into the single
 * docType a search result reports.
 *
 * A topic legitimately carries more than one: every Jamf Pro release note is
 * tagged both `content-techdocs` and `content-releasenotes`, and solution
 * guides and getting-started pages are likewise tagged alongside techdocs.
 * `content-techdocs` sits on ~93% of all topics, so it is the least
 * informative label and ranks last; anything else out-describes it.
 *
 * Must list every {@link DocTypeId} — enforced by unit test.
 */
export const DOC_TYPE_PRECEDENCE: readonly DocTypeId[] = [
  'release-notes',
  'glossary',
  'training',
  'solution-guide',
  'getting-started',
  'documentation',
];

/**
 * Forward mapping: docType -> Fluid Topics `jamf:contentType` metadata value.
 *
 * **Do not use this to filter a search.** The values are English, and
 * `jamf:contentType` is one of the few FT metadata keys whose *values* are
 * translated per locale: the topics that carry 'Release Notes' under en-US
 * carry '版本資訊' under zh-TW, 'リリースノート' under ja-JP,
 * 'Versionshinweise' under de-DE, and so on. Sending the English string as an
 * upstream filter matched topics under en-US and exactly 0 under every
 * other locale this server supports. {@link DOC_TYPE_LABEL_MAP}'s `content-*`
 * vocabulary is locale-invariant and is what `buildSearchFilters` uses.
 *
 * Kept because it is a published export and still describes a real FT field,
 * but it is not a query-building map. The mapping is also many-to-one
 * ('Technical Documentation' covers four docTypes) and so cannot be reversed —
 * use {@link LABEL_KEY_DOC_TYPE_MAP} to go the other way.
 */
export const DOC_TYPE_CONTENT_TYPE_MAP: Record<string, string> = {
  'documentation': 'Technical Documentation',
  'release-notes': 'Release Notes',
  'glossary': 'Glossary',
  'training': 'Technical Documentation',
  'solution-guide': 'Technical Documentation',
  'getting-started': 'Technical Documentation',
};

/**
 * The `jamf:contentType` values Jamf gives its training content, "Training
 * Content", in every language Jamf has any in.
 *
 * They reach what `content-training` cannot: a course or learning path of
 * the Jamf Training Catalog, which Jamf's search lists among the
 * documentation (a DOCUMENT entry, see `FtSearchDocument`), carries one of
 * them and no `content-*` label. So `docType: 'training'` is searched for by
 * these, which select what Jamf classifies as training content, courses
 * included, and a result with no `content-*` label is training when it
 * carries one (see `docTypeLabelKeys` in search-service.ts).
 *
 * Listed in every language, not the one searched, so that one filter serves
 * them all: values within a filter are a union. Measured live on 2026-09-28:
 * the 21 maps labelled `content-training` carry one of these each, and none
 * of the other 664 maps does. Filtered by them, 13 searches in six languages
 * returned the `content-training` topics, in the same order, with the
 * courses among them (see trainingContentFilters in search-service.ts).
 * `data-contracts` checks that the maps still pair them so.
 */
export const TRAINING_CONTENT_TYPES: readonly string[] = [
  'Training Content',
  'Schulungsinhalt',
  'Contenido de formación',
  'Contenu de la formation',
  'トレーニングコンテンツ',
  '培訓內容',
];

// Derived ID array (shared by schemas, completions, etc.)
export const DOC_TYPE_IDS = Object.keys(DOC_TYPES) as [string, ...string[]];
