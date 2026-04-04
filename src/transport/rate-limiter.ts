/**
 * Token bucket rate limiter (per-IP)
 */

/** Maximum unique IPs tracked by rate limiter to prevent memory exhaustion */
export const MAX_RATE_LIMIT_BUCKETS = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly maxTokens: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;

  constructor(
    maxTokens: number,
    windowMs: number,
    maxBuckets: number = MAX_RATE_LIMIT_BUCKETS,
  ) {
    this.maxTokens = maxTokens;
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (bucket === undefined) {
      // Evict oldest entry if at capacity to prevent memory exhaustion
      if (this.buckets.size >= this.maxBuckets) {
        this.evictOldest();
      }
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / this.windowMs) * this.maxTokens;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  // Evict the oldest bucket entry using Map insertion order (O(1))
  private evictOldest(): void {
    const firstKey = this.buckets.keys().next().value;
    if (firstKey !== undefined) {
      this.buckets.delete(firstKey);
    }
  }

  // Periodically clean up old entries to prevent memory leak
  cleanup(): void {
    const now = Date.now();
    for (const [ip, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.windowMs * 2) {
        this.buckets.delete(ip);
      }
    }
  }
}
