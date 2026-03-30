/**
 * Cache types and schema re-exports
 *
 * The actual cache implementation is platform-specific.
 * See src/platforms/node/cache.ts for the Node.js FileCache.
 */
import { z } from 'zod';

/**
 * Zod schema for validating cache entries read from disk
 */
export const CacheEntrySchema = z.object({
  data: z.unknown(),
  timestamp: z.number(),
  ttl: z.number()
});
