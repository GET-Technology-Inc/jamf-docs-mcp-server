/**
 * Constants barrel — the path 35 modules import from.
 *
 * The constants themselves live in ./constants/: products.ts, locales.ts,
 * topics.ts, doc-types.ts, limits.ts. ./constants/index.ts gathers them.
 *
 * This file used to re-list all 32 names that barrel already lists, so adding a
 * constant meant editing two files, and forgetting the second was invisible:
 * every `../constants.js` importer would simply not see it, with no error
 * anywhere. The two lists were verified identical before collapsing them, so
 * `export *` is exactly what the explicit list already meant.
 */

export * from './constants/index.js';
