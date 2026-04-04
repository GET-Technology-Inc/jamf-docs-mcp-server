/**
 * Unit tests for logging service
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggingService, createStderrLogger } from '../../../src/core/services/logging.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';

// Spy on console.error for stderr verification
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stderrSpy.mockRestore();
});

// ============================================================================
// createStderrLogger: stderr-only logger for bootstrap code
// ============================================================================

describe('createStderrLogger', () => {
  it('should return a logger with all RFC 5424 level methods', () => {
    const log = createStderrLogger('test');
    const levels: (keyof Logger)[] = [
      'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
    ];
    for (const level of levels) {
      expect(typeof log[level]).toBe('function');
    }
  });

  it('should include logger name in stderr output', () => {
    const log = createStderrLogger('search');
    log.info('test message');
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [search] test message');
  });

  it('should include correct level label in stderr output', () => {
    const log = createStderrLogger('cache');
    log.warning('disk full');
    expect(stderrSpy).toHaveBeenCalledWith('[WARNING] [cache] disk full');
  });

  it('should handle structured data by JSON stringifying', () => {
    const log = createStderrLogger('scraper');
    const data = { query: 'mdm', product: 'jamf-pro' };
    log.debug(data);
    expect(stderrSpy).toHaveBeenCalledWith(
      `[DEBUG] [scraper] ${JSON.stringify(data)}`
    );
  });

  it('should handle all level methods correctly', () => {
    const log = createStderrLogger('test');
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
// LoggingService.createLogger: instance-scoped logger with MCP support
// ============================================================================

describe('LoggingService.createLogger', () => {
  it('should return a logger with all RFC 5424 level methods', () => {
    const service = new LoggingService();
    const log = service.createLogger('test');
    const levels: (keyof Logger)[] = [
      'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
    ];
    for (const level of levels) {
      expect(typeof log[level]).toBe('function');
    }
  });

  it('should include logger name in stderr output', () => {
    const service = new LoggingService();
    const log = service.createLogger('search');
    log.info('test message');
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [search] test message');
  });
});

// ============================================================================
// Before setServer: log only writes stderr without throwing
// ============================================================================

describe('logging before setServer', () => {
  it('should write to stderr without throwing', () => {
    const service = new LoggingService();
    const log = service.createLogger('server');
    expect(() => { log.info('startup'); }).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [server] startup');
  });

  it('should handle error level without throwing', () => {
    const service = new LoggingService();
    const log = service.createLogger('server');
    expect(() => { log.error('something broke'); }).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith('[ERROR] [server] something broke');
  });
});

// ============================================================================
// After setServer: log sends MCP notification AND stderr
// ============================================================================

describe('logging after setServer', () => {
  it('should call sendLoggingMessage when server is set', () => {
    const service = new LoggingService();
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    service.setServer(mockServer as never);

    const log = service.createLogger('search');
    log.info('query executed');

    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [search] query executed');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'search',
      data: 'query executed',
    });
  });

  it('should send structured data via MCP notification', () => {
    const service = new LoggingService();
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    service.setServer(mockServer as never);

    const log = service.createLogger('metadata');
    const data = { productId: 'jamf-pro', versions: ['11.0', '11.1'] };
    log.debug(data);

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'debug',
      logger: 'metadata',
      data,
    });
  });

  it('should not throw if sendLoggingMessage rejects', () => {
    const service = new LoggingService();
    const mockServer = {
      sendLoggingMessage: vi.fn().mockRejectedValue(new Error('not connected')),
    };
    service.setServer(mockServer as never);

    const log = service.createLogger('server');
    expect(() => { log.info('test'); }).not.toThrow();
  });

  it('should not call sendLoggingMessage after server is unset', () => {
    const service = new LoggingService();
    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    service.setServer(mockServer as never);
    service.setServer(null as never);

    const log = service.createLogger('test');
    log.info('msg');

    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [test] msg');
  });

  it('should not leak state between LoggingService instances', () => {
    const service1 = new LoggingService();
    const service2 = new LoggingService();

    const mockServer = {
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };
    service1.setServer(mockServer as never);

    // service2 never had setServer called — should not send MCP logs
    const log2 = service2.createLogger('isolated');
    log2.info('test');

    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [isolated] test');
  });
});

// ============================================================================
// Configurable writeStderr: platform-specific output
// ============================================================================

describe('configurable writeStderr', () => {
  it('should use custom writer in LoggingService when provided', () => {
    const customWriter = vi.fn();
    const service = new LoggingService(customWriter);
    const log = service.createLogger('custom');

    log.info('hello');

    expect(customWriter).toHaveBeenCalledWith('[INFO] [custom] hello');
    // Should NOT call console.error when a custom writer is provided
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should use custom writer in createStderrLogger when provided', () => {
    const customWriter = vi.fn();
    const log = createStderrLogger('bootstrap', customWriter);

    log.warning('starting up');

    expect(customWriter).toHaveBeenCalledWith('[WARNING] [bootstrap] starting up');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should accept a no-op writer for silent logging', () => {
    const noop = vi.fn();
    const service = new LoggingService(noop);
    const log = service.createLogger('silent');

    log.error('suppressed');

    expect(noop).toHaveBeenCalledWith('[ERROR] [silent] suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should default to console.error when no writer is provided', () => {
    const service = new LoggingService();
    const log = service.createLogger('default');

    log.info('fallback');

    expect(stderrSpy).toHaveBeenCalledWith('[INFO] [default] fallback');
  });
});
