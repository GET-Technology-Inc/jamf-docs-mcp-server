/**
 * Unit tests for logging service
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger, setServer } from '../../../src/services/logging.js';
import type { Logger } from '../../../src/services/logging.js';

// Spy on console.error for stderr verification
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stderrSpy.mockRestore();
});

// ============================================================================
// createLogger: named logger with all level methods
// ============================================================================

describe('createLogger', () => {
  it('should return a logger with all RFC 5424 level methods', () => {
    const log = createLogger('test');
    const levels: (keyof Logger)[] = [
      'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
    ];
    for (const level of levels) {
      expect(typeof log[level]).toBe('function');
    }
  });

  it('should include logger name in stderr output', () => {
    const log = createLogger('search');
    log.info('test message');
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [search] test message');
  });

  it('should include correct level label in stderr output', () => {
    const log = createLogger('cache');
    log.warning('disk full');
    expect(stderrSpy).toHaveBeenCalledWith('[WARNING] [cache] disk full');
  });

  it('should handle structured data by JSON stringifying', () => {
    const log = createLogger('scraper');
    const data = { query: 'mdm', product: 'jamf-pro' };
    log.debug(data);
    expect(stderrSpy).toHaveBeenCalledWith(
      `[DEBUG] [scraper] ${JSON.stringify(data)}`
    );
  });

  it('should handle all level methods correctly', () => {
    const log = createLogger('test');
    const levels: [keyof Logger, string][] = [
      ['debug', 'DEBUG'],
      ['info', 'INFO'],
      ['notice', 'NOTICE'],
      ['warning', 'WARNING'],
      ['error', 'ERROR'],
      ['critical', 'CRITICAL'],
      ['alert', 'ALERT'],
      ['emergency', 'EMERGENCY'],
    ];

    for (const [method, label] of levels) {
      log[method]('msg');
      expect(stderrSpy).toHaveBeenCalledWith(`[${label}] [test] msg`);
    }
  });
});

// ============================================================================
// Before setServer: log only writes stderr without throwing
// ============================================================================

describe('logging before setServer', () => {
  it('should write to stderr without throwing', () => {
    const log = createLogger('server');
    expect(() => { log.info('startup'); }).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [server] startup');
  });

  it('should handle error level without throwing', () => {
    const log = createLogger('server');
    expect(() => { log.error('something broke'); }).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith('[ERROR] [server] something broke');
  });
});

// ============================================================================
// After setServer: log sends MCP notification AND stderr
// ============================================================================

describe('logging after setServer', () => {
  afterEach(() => {
    setServer(null as never);
  });

  it('should call sendLoggingMessage when server is set', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    setServer(mockServer as never);

    const log = createLogger('search');
    log.info('query executed');

    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [search] query executed');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'search',
      data: 'query executed',
    });
  });

  it('should send structured data via MCP notification', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    setServer(mockServer as never);

    const log = createLogger('metadata');
    const data = { productId: 'jamf-pro', versions: ['11.0', '11.1'] };
    log.debug(data);

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'debug',
      logger: 'metadata',
      data,
    });
  });

  it('should not throw if sendLoggingMessage rejects', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockRejectedValue(new Error('not connected')),
    };
    setServer(mockServer as never);

    const log = createLogger('server');
    expect(() => { log.info('test'); }).not.toThrow();
  });

  it('should not call sendLoggingMessage after server is unset', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    setServer(mockServer as never);
    setServer(null as never);

    const log = createLogger('test');
    log.info('msg');

    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [test] msg');
  });
});
