/**
 * The environment variables the READMEs document, read from their
 * configuration tables.
 *
 * Shared by env-vars-documented.test.ts, which asks whether src/ mentions each
 * one, and env-vars-take-effect.test.ts, which asks what each one does and
 * whether the server reads any other.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The READMEs that document the configuration. */
export const ENV_DOCS = ['README.md', 'docs/README.zh-TW.md'] as const;

/**
 * Names in the leading cell of a documentation table row of `doc`, which is
 * how both READMEs list configuration variables. Deliberately not every
 * backticked token: prose mentions Node's own `ERR_MODULE_NOT_FOUND`, which is
 * not ours.
 */
export function documentedEnvVars(doc: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  return [...new Set(
    [...text.matchAll(/^\| {0,2}`([A-Z][A-Z0-9_]*)` {0,2}\|/gm)].map(m => m[1]),
  )].sort();
}

/** Every variable either README documents. */
export function everyDocumentedEnvVar(): string[] {
  return [...new Set(ENV_DOCS.flatMap(documentedEnvVars))].sort();
}
