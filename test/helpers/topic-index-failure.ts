/**
 * Child-process fixture: drive `TopicResolver` through a failed topic-index
 * fetch and let the process run to completion.
 *
 * Run with `node --import tsx test/helpers/topic-index-failure.ts`. The point
 * is the exit code, which is why this cannot be an ordinary test: an unhandled
 * rejection terminates the *process*, and a test runner intercepts that. Only
 * a real process can answer whether the server would have survived.
 *
 * Prints one line of JSON to stdout: the caller-visible outcome and the number
 * of upstream calls, so the harness can also confirm dedup and cleanup.
 */

import { TopicResolver } from '../../src/core/services/topic-resolver.js';
import type { CacheProvider } from '../../src/core/services/interfaces/index.js';
import type { MapsRegistry } from '../../src/core/services/maps-registry.js';

// Always-empty cache. Each method awaits an already-resolved promise so it is
// a genuine async function rather than an `async` keyword with nothing behind
// it; the `CacheProvider` contract requires thenables.
const cache: CacheProvider = {
  get: async () => await Promise.resolve(null),
  set: async () => { await Promise.resolve(); },
  delete: async () => await Promise.resolve(false),
  clear: async () => { await Promise.resolve(); },
  // Never reached: this fixture only drives the topic-index path.
  stats: async () => await Promise.resolve({ memoryEntries: 0, totalEntries: 0 }),
  prune: async () => await Promise.resolve(0),
};

let upstreamCalls = 0;
const alwaysFails = async (): Promise<never> => {
  upstreamCalls++;
  return await Promise.reject(new Error('HTTP 503 Service Unavailable'));
};

// The registry is never reached: this exercises the topic-index path only.
const resolver = new TopicResolver(
  {} as MapsRegistry,
  cache,
  alwaysFails,
);

// `getTopicIndex` is private. The fixture is about its promise wiring rather
// than its public surface, so it is reached directly.
const getTopicIndex = (
  resolver as unknown as { getTopicIndex: (mapId: string) => Promise<unknown> }
).getTopicIndex.bind(resolver);

const outcomes = await Promise.allSettled([
  getTopicIndex('map-1'),
  getTopicIndex('map-1'),
]);

// A later attempt must reach upstream again, proving the in-flight entry was
// cleared rather than pinning the failure forever.
await getTopicIndex('map-1').catch(() => undefined);

// Give any unhandled rejection a turn of the loop to terminate the process.
await new Promise((resolve) => setTimeout(resolve, 100));

process.stdout.write(
  `${JSON.stringify({
    outcomes: outcomes.map((o) => o.status),
    upstreamCalls,
    survived: true,
  })}\n`,
);
