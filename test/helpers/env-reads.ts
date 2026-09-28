/**
 * Which environment variables the server's own code reads.
 *
 * Used by env-vars-take-effect.test.ts in its own process, while every tool
 * is called, and in the platform entry's process through
 * env-reads.preload.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * How a frame in src/ names its file: as a path in process under vitest, as a
 * file URL in a child run through tsx. Both spellings of the root, in case
 * the checkout is reached through a symlink.
 */
const SRC_FRAMES = [...new Set([ROOT, fs.realpathSync(ROOT)])]
  .map(root => path.join(root, 'src') + path.sep)
  .flatMap(src => [src, pathToFileURL(src).href]);

/**
 * Call `onRead` with each name looked up on `process.env` by code under src/,
 * until the function returned is called. A lookup counts when its caller, the
 * frame just below the proxy's trap, is a file there: what Node or a
 * dependency reads is not the server's configuration.
 */
export function recordEnvReads(onRead: (name: string) => void): () => void {
  const note = (name: string | symbol): void => {
    if (typeof name !== 'string') { return; }
    // [0] is the message, [1] this function and [2] the trap.
    const caller = (new Error().stack ?? '').split('\n')[3] ?? '';
    if (SRC_FRAMES.some(src => caller.includes(src))) { onRead(name); }
  };
  const { env } = process;
  process.env = new Proxy(env, {
    get: (target, name, receiver) => { note(name); return Reflect.get(target, name, receiver) as unknown; },
    has: (target, name) => { note(name); return Reflect.has(target, name); },
    // A write must reach process.env as a plain assignment. Without this trap
    // it arrives through the proxy's [[DefineOwnProperty]] with a descriptor
    // that has only a value, which process.env refuses for a name it already
    // has: `vi.unstubAllEnvs()` putting back an exported CACHE_DIR threw
    // "'process.env' only accepts a configurable, writable, and enumerable
    // data descriptor".
    set: (target, name, value) => Reflect.set(target, name, value),
  });
  return () => { process.env = env; };
}
