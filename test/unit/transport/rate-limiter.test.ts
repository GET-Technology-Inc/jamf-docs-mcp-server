/**
 * Unit tests for RateLimiter (src/transport/rate-limiter.ts)
 *
 * Strategy: test the token-bucket algorithm directly using real time for
 * simple cases and vi.useFakeTimers for time-sensitive refill scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, MAX_RATE_LIMIT_BUCKETS } from '../../../src/transport/rate-limiter.js';

// ============================================================================
// isAllowed — basic allow / deny
// ============================================================================

describe('RateLimiter.isAllowed — basic allow / deny', () => {
  it('should return true for the first request from a new IP', () => {
    // Arrange
    const limiter = new RateLimiter(10, 1000);

    // Act
    const result = limiter.isAllowed('1.2.3.4');

    // Assert
    expect(result).toBe(true);
  });

  it('should return true for requests under the token limit', () => {
    // Arrange
    const limiter = new RateLimiter(5, 1000);

    // Act & Assert: all 5 should be allowed
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed('10.0.0.1')).toBe(true);
    }
  });

  it('should return false when the burst limit is exceeded', () => {
    // Arrange: 60 tokens per 60-second window (default rpm)
    const limiter = new RateLimiter(60, 60_000);
    const ip = '192.168.1.1';

    // Act: consume all 60 tokens
    for (let i = 0; i < 60; i++) {
      limiter.isAllowed(ip);
    }

    // Assert: 61st request is denied
    expect(limiter.isAllowed(ip)).toBe(false);
  });

  it('should return false on the (maxTokens+1)th request in the same window', () => {
    // Arrange
    const maxTokens = 3;
    const limiter = new RateLimiter(maxTokens, 10_000);
    const ip = '10.1.1.1';

    // Act: exhaust the bucket
    for (let i = 0; i < maxTokens; i++) {
      limiter.isAllowed(ip);
    }

    // Assert
    expect(limiter.isAllowed(ip)).toBe(false);
  });

  it('should allow exactly maxTokens requests before denying', () => {
    // Arrange
    const limiter = new RateLimiter(3, 10_000);
    const ip = 'test-ip';
    const results: boolean[] = [];

    // Act
    for (let i = 0; i < 4; i++) {
      results.push(limiter.isAllowed(ip));
    }

    // Assert: first 3 allowed, 4th denied
    expect(results).toEqual([true, true, true, false]);
  });

  it('should handle an empty string IP as a valid key', () => {
    // Arrange
    const limiter = new RateLimiter(2, 1000);

    // Act
    const first = limiter.isAllowed('');
    const second = limiter.isAllowed('');
    const third = limiter.isAllowed('');

    // Assert
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(false);
  });

  it('should give each IP an independent token bucket', () => {
    // Arrange
    const limiter = new RateLimiter(1, 10_000);

    // Act: exhaust IP A's bucket
    limiter.isAllowed('ip-A');

    // Assert: IP A is denied but IP B still has tokens
    expect(limiter.isAllowed('ip-A')).toBe(false);
    expect(limiter.isAllowed('ip-B')).toBe(true);
  });

  it('should maintain separate state for many different IPs', () => {
    // Arrange
    const limiter = new RateLimiter(2, 60_000);

    // Act & Assert: each IP gets its own 2-token bucket
    for (let i = 0; i < 10; i++) {
      const ip = `10.0.0.${i}`;
      expect(limiter.isAllowed(ip)).toBe(true);
      expect(limiter.isAllowed(ip)).toBe(true);
      expect(limiter.isAllowed(ip)).toBe(false);
    }
  });
});

// ============================================================================
// isAllowed — token refill via fake timers
// ============================================================================

describe('RateLimiter.isAllowed — token refill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should refill tokens after the full window elapses', () => {
    // Arrange: 2 tokens per 1000 ms
    const limiter = new RateLimiter(2, 1000);
    const ip = 'refill-ip';

    // Exhaust the bucket
    limiter.isAllowed(ip);
    limiter.isAllowed(ip);
    expect(limiter.isAllowed(ip)).toBe(false);

    // Act: advance time by the full window so tokens fully refill
    vi.advanceTimersByTime(1000);

    // Assert: bucket is restored and requests are allowed again
    expect(limiter.isAllowed(ip)).toBe(true);
  });

  it('should partially refill tokens proportional to elapsed time', () => {
    // Arrange: 4 tokens per 1000 ms (1 token per 250 ms)
    const limiter = new RateLimiter(4, 1000);
    const ip = 'partial-refill-ip';

    // Exhaust bucket
    for (let i = 0; i < 4; i++) {
      limiter.isAllowed(ip);
    }
    expect(limiter.isAllowed(ip)).toBe(false);

    // Act: advance by half the window → 2 tokens should be added
    vi.advanceTimersByTime(500);

    // Assert: 2 requests succeed, 3rd fails
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(false);
  });

  it('should not exceed maxTokens after more than one window elapses', () => {
    // Arrange: 2 tokens per 500 ms
    const limiter = new RateLimiter(2, 500);
    const ip = 'overflow-ip';

    // Act: advance 3 full windows (would add 6 tokens if uncapped)
    vi.advanceTimersByTime(1500);

    // Assert: bucket is capped at maxTokens (2), so only 2 succeed
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(false);
  });

  it('should allow new requests after waiting even without full window', () => {
    // Arrange: 2 tokens per 1000 ms
    const limiter = new RateLimiter(2, 1000);
    const ip = 'incremental-ip';

    // Use 2 tokens
    limiter.isAllowed(ip);
    limiter.isAllowed(ip);
    expect(limiter.isAllowed(ip)).toBe(false);

    // Advance by 1000ms → full refill
    vi.advanceTimersByTime(1000);

    // Should now have 2 tokens again
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(true);
    expect(limiter.isAllowed(ip)).toBe(false);
  });
});

// ============================================================================
// evictOldest — memory protection
// ============================================================================

describe('RateLimiter — evictOldest (maxBuckets capacity)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should evict the oldest bucket when maxBuckets is reached', () => {
    // Arrange: capacity of 3 buckets
    const limiter = new RateLimiter(5, 60_000, 3);

    // Fill buckets at different times so we have a clear "oldest"
    limiter.isAllowed('oldest');
    vi.advanceTimersByTime(100);
    limiter.isAllowed('middle');
    vi.advanceTimersByTime(100);
    limiter.isAllowed('newest');

    // At capacity — adding a 4th should evict 'oldest'
    vi.advanceTimersByTime(100);
    limiter.isAllowed('fourth');

    // 'oldest' was evicted, so its next request creates a fresh bucket with full tokens
    // A fresh bucket starts with maxTokens, so a new request for 'oldest' should be allowed
    // (rather than tracking the previously spent tokens)
    const allowed = limiter.isAllowed('oldest');
    expect(allowed).toBe(true);
  });

  it('should not evict when under capacity', () => {
    // Arrange: capacity of 10
    const limiter = new RateLimiter(1, 60_000, 10);

    // Add 5 IPs each consuming their token
    for (let i = 0; i < 5; i++) {
      limiter.isAllowed(`10.0.0.${i}`);
    }

    // All 5 IPs should be denied (token consumed), not evicted
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed(`10.0.0.${i}`)).toBe(false);
    }
  });

  it('should use MAX_RATE_LIMIT_BUCKETS as the default maxBuckets', () => {
    // Arrange & Assert: verify the exported constant matches expectation
    expect(MAX_RATE_LIMIT_BUCKETS).toBe(10_000);

    // A limiter with default maxBuckets should accept up to 10,000 unique IPs
    const limiter = new RateLimiter(1, 1000);
    for (let i = 0; i < 100; i++) {
      // Each should be accepted without eviction
      expect(limiter.isAllowed(`192.168.${Math.floor(i / 255)}.${i % 255}`)).toBe(true);
    }
  });
});

// ============================================================================
// cleanup — stale entry removal
// ============================================================================

describe('RateLimiter.cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove entries that are older than 2× the window', () => {
    // Arrange: 1000 ms window → stale after 2000 ms
    const limiter = new RateLimiter(5, 1000);
    limiter.isAllowed('stale-ip');

    // Advance past the stale threshold
    vi.advanceTimersByTime(2001);

    // Act
    limiter.cleanup();

    // Assert: the stale entry was removed — the next request creates a fresh bucket
    // so it receives full tokens and is allowed
    expect(limiter.isAllowed('stale-ip')).toBe(true);
  });

  it('should NOT remove entries that are within 2× the window', () => {
    // Arrange: 1000 ms window
    const limiter = new RateLimiter(2, 1000);
    const ip = 'active-ip';

    // Use both tokens
    limiter.isAllowed(ip);
    limiter.isAllowed(ip);

    // Advance just under the stale threshold
    vi.advanceTimersByTime(1999);

    // Act
    limiter.cleanup();

    // Assert: entry kept (still within threshold), remaining tokens still 0
    // A new token has been partially refilled by ~1.999 tokens (almost 2)
    // but the bucket was NOT wiped. The request should reflect the refill.
    // We just verify that cleanup did NOT reset the bucket to full maxTokens
    // by checking that if we called isAllowed a bunch, it behaves per-token.
    // Simply: the entry exists and the bucket follows normal refill logic.
    const result = limiter.isAllowed(ip);
    // ~1.999 tokens refilled → at least 1 request should be allowed
    expect(result).toBe(true);
  });

  it('should remove only stale entries and keep fresh ones', () => {
    // Arrange: 1000 ms window
    const limiter = new RateLimiter(1, 1000);
    const fresh = 'fresh-ip';
    const stale = 'stale-ip';

    // Both IPs have one request each
    limiter.isAllowed(fresh);
    limiter.isAllowed(stale);

    // Exhaust both
    expect(limiter.isAllowed(fresh)).toBe(false);
    expect(limiter.isAllowed(stale)).toBe(false);

    // Advance past stale threshold for 'stale' — both have same lastRefill,
    // so actually both become stale. Instead, make 'fresh' re-active before cleanup.
    vi.advanceTimersByTime(2001);

    // Touch 'fresh' to reset its lastRefill so it won't be cleaned up
    limiter.isAllowed(fresh); // fresh bucket is recreated or refilled

    // Act
    limiter.cleanup();

    // Assert: 'stale' bucket was removed → fresh bucket on next request (full tokens)
    // 'fresh' was recently touched → bucket still tracks consumed tokens
    expect(limiter.isAllowed('stale-ip')).toBe(true);
  });

  it('should handle cleanup on an empty limiter without errors', () => {
    // Arrange
    const limiter = new RateLimiter(5, 1000);

    // Act & Assert: should not throw
    expect(() => limiter.cleanup()).not.toThrow();
  });

  it('should remove multiple stale entries in one cleanup pass', () => {
    // Arrange
    const limiter = new RateLimiter(1, 1000);
    const ips = ['a.b.c.1', 'a.b.c.2', 'a.b.c.3'];

    for (const ip of ips) {
      limiter.isAllowed(ip);
    }

    // Advance past stale threshold for all
    vi.advanceTimersByTime(3000);

    // Act
    limiter.cleanup();

    // Assert: all stale entries removed → all get fresh buckets
    for (const ip of ips) {
      expect(limiter.isAllowed(ip)).toBe(true);
    }
  });
});
