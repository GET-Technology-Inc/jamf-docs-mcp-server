/**
 * Backward-compatible re-export.
 *
 * The real implementation lives in `platforms/node/http-server.ts`.
 * This shim preserves the dynamic import path used in `src/index.ts`.
 */

export { startHttpServer } from '../platforms/node/http-server.js';
