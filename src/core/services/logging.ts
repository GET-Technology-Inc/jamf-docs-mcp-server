/**
 * Structured logging service.
 *
 * Output goes to stderr only. SEP-2577 deprecated the MCP Logging feature in
 * protocol revision 2026-07-28 — `logging/setLevel` is gone and servers must
 * not emit `notifications/message` for requests that did not opt in — and the
 * suggested migration for a stdio server is exactly this: write to stderr.
 * Platforms without a stderr stream (Cloudflare Workers) supply their own
 * writer, which lands in the platform log sink.
 */

import type { LoggingLevel } from '@modelcontextprotocol/server';
import type { Logger, WriteStderrFn } from './interfaces/index.js';

export type { Logger, WriteStderrFn };

/**
 * Default writer — delegates to console.error (Node.js stderr).
 * Uses late binding so test spies on console.error are respected.
 */
function defaultWriteStderr(formatted: string): void {
  console.error(formatted);
}

function formatLogLine(
  level: LoggingLevel,
  loggerName: string,
  data: unknown,
): string {
  const label = level.toUpperCase();
  let message: string;
  if (typeof data === 'string') {
    message = data;
  } else {
    try {
      message = JSON.stringify(data);
    } catch {
      message = String(data);
    }
  }
  return `[${label}] [${loggerName}] ${message}`;
}

/**
 * Logging service that holds MCP server reference as instance state.
 *
 * Each server instance should create its own LoggingService, so that
 * multiple servers running in the same isolate don't share state.
 *
 * @param writeStderr - Optional writer function for stderr-style output.
 *   Defaults to `console.error`. Pass `console.log` or a no-op for
 *   platforms without stderr (e.g. Cloudflare Workers).
 */
export class LoggingService {
  private readonly writeStderr: WriteStderrFn;

  constructor(writeStderr?: WriteStderrFn) {
    this.writeStderr = writeStderr ?? defaultWriteStderr;
  }

  /**
   * Create a named logger instance.
   *
   * @param name - Logger name identifying the source module
   */
  createLogger(name: string): Logger {
    return {
      debug: (data: unknown) => { this.log('debug', name, data); },
      info: (data: unknown) => { this.log('info', name, data); },
      notice: (data: unknown) => { this.log('notice', name, data); },
      warning: (data: unknown) => { this.log('warning', name, data); },
      error: (data: unknown) => { this.log('error', name, data); },
      critical: (data: unknown) => { this.log('critical', name, data); },
      alert: (data: unknown) => { this.log('alert', name, data); },
      emergency: (data: unknown) => { this.log('emergency', name, data); },
    };
  }

  private log(level: LoggingLevel, loggerName: string, data: unknown): void {
    this.writeStderr(formatLogLine(level, loggerName, data));
  }
}

/**
 * Create a stderr-only logger (no MCP notifications).
 *
 * Use this for bootstrap / transport code that runs before
 * a ServerContext is available, or outside of a request scope.
 *
 * @param name - Logger name identifying the source module
 * @param writeStderr - Optional writer function (defaults to console.error)
 */
export function createStderrLogger(
  name: string,
  writeStderr?: WriteStderrFn,
): Logger {
  const writer = writeStderr ?? defaultWriteStderr;
  return {
    debug: (data: unknown) => { writer(formatLogLine('debug', name, data)); },
    info: (data: unknown) => { writer(formatLogLine('info', name, data)); },
    notice: (data: unknown) => { writer(formatLogLine('notice', name, data)); },
    warning: (data: unknown) => { writer(formatLogLine('warning', name, data)); },
    error: (data: unknown) => { writer(formatLogLine('error', name, data)); },
    critical: (data: unknown) => { writer(formatLogLine('critical', name, data)); },
    alert: (data: unknown) => { writer(formatLogLine('alert', name, data)); },
    emergency: (data: unknown) => { writer(formatLogLine('emergency', name, data)); },
  };
}
