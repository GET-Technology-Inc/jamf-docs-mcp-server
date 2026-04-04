/**
 * Structured logging service for MCP protocol
 *
 * Provides dual output: MCP notifications (visible to AI clients) + stderr (visible to developers).
 * Log level filtering for MCP notifications is handled by the SDK (logging/setLevel).
 *
 * LoggingService is a class that holds the MCP server reference as instance state,
 * avoiding module-level mutable singletons that are incompatible with
 * Cloudflare Workers (where module scope persists across requests).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
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
  private mcpServer: McpServer | null = null;
  private readonly writeStderr: WriteStderrFn;

  constructor(writeStderr?: WriteStderrFn) {
    this.writeStderr = writeStderr ?? defaultWriteStderr;
  }

  /**
   * Register the MCP server instance for sending log notifications.
   * Must be called after server creation but before tools are invoked.
   */
  setServer(server: McpServer): void {
    this.mcpServer = server;
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
    this.sendMcpLog(level, loggerName, data);
  }

  private sendMcpLog(level: LoggingLevel, loggerName: string, data: unknown): void {
    if (this.mcpServer === null) {
      return;
    }

    // Fire-and-forget: don't await, don't throw
    this.mcpServer.sendLoggingMessage({ level, logger: loggerName, data }).catch(() => {
      // Silently ignore send failures (server may not be connected yet)
    });
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
