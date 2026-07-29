/**
 * Child-process fixture for the graceful-shutdown regression test.
 *
 * Run with `node --import tsx test/helpers/slow-http-server.ts`. It starts the
 * real Node HTTP adapter — signal handlers, drain window, `process.exit` and
 * all — in front of {@link createSlowServer}, which is the only way to
 * exercise the SIGTERM path end to end: the adapter kills its own process, so
 * it cannot be driven from inside the test runner.
 *
 * Environment:
 *   PORT  port to bind (required)
 */

import { startHttpServer } from '../../src/platforms/node/http-server.js';
import { createSlowServer } from './slow-server.js';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be set to a valid port number');
}

await startHttpServer(createSlowServer, port, '127.0.0.1');
