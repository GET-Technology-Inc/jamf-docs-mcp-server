/**
 * Preloaded into the platform entry by env-vars-take-effect.test.ts:
 * `node --import tsx --import <this> src/index.ts ...`. It writes the names of
 * the environment variables code in src/ reads (see env-reads.ts), as a JSON
 * array, to the file ENV_READS_FILE names.
 *
 * The file is written at once and again on each new name, so whatever the
 * server has read by the time the test looks is in it, and the server does
 * not have to exit first.
 *
 * Environment:
 *   ENV_READS_FILE  the file to write (required)
 */

import * as fs from 'fs';
import { recordEnvReads } from './env-reads.js';

const out = process.env.ENV_READS_FILE;
if (out === undefined || out === '') {
  throw new Error('ENV_READS_FILE must name the file to write the names to');
}

const names = new Set<string>();
fs.writeFileSync(out, '[]');
recordEnvReads((name) => {
  if (names.has(name)) { return; }
  names.add(name);
  fs.writeFileSync(out, JSON.stringify([...names]));
});
