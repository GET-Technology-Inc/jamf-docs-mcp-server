import { describe, it, expect } from 'vitest';
import { CacheEntrySchema } from '../../src/core/services/cache.js';

describe('CacheEntrySchema validation', () => {
  it('should accept valid cache entry', () => {
    const valid = { data: { title: 'test' }, timestamp: Date.now(), ttl: 60000 };
    const result = CacheEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject entry with missing timestamp', () => {
    const invalid = { data: 'test', ttl: 60000 };
    const result = CacheEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject entry with missing ttl', () => {
    const invalid = { data: 'test', timestamp: Date.now() };
    const result = CacheEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject entry with string timestamp', () => {
    const invalid = { data: 'test', timestamp: '2024-01-01', ttl: 60000 };
    const result = CacheEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject entry with string ttl', () => {
    const invalid = { data: 'test', timestamp: Date.now(), ttl: '60000' };
    const result = CacheEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept entry with null data', () => {
    const valid = { data: null, timestamp: Date.now(), ttl: 60000 };
    const result = CacheEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject completely invalid input', () => {
    expect(CacheEntrySchema.safeParse('not an object').success).toBe(false);
    expect(CacheEntrySchema.safeParse(42).success).toBe(false);
    expect(CacheEntrySchema.safeParse(null).success).toBe(false);
  });
});
