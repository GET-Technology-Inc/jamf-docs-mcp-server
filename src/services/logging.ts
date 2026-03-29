/**
 * Structured logging service for MCP protocol
 *
 * Provides dual output: MCP notifications (visible to AI clients) + stderr (visible to developers).
 * Log level filtering for MCP notifications is handled by the SDK (logging/setLevel).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

let mcpServer: McpServer | null = null;

/**
 * Register the MCP server instance for sending log notifications.
 * Must be called after server creation but before tools are invoked.
 */
export function setServer(server: McpServer): void {
  mcpServer = server;
}

/**
 * Logger instance bound to a specific logger name.
 */
export interface Logger {
  debug: (data: unknown) => void;
  info: (data: unknown) => void;
  notice: (data: unknown) => void;
  warning: (data: unknown) => void;
  error: (data: unknown) => void;
  critical: (data: unknown) => void;
  alert: (data: unknown) => void;
  emergency: (data: unknown) => void;
}

function writeStderr(level: LoggingLevel, loggerName: string, data: unknown): void {
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
  console.error(`[${label}] [${loggerName}] ${message}`);
}

function sendMcpLog(level: LoggingLevel, loggerName: string, data: unknown): void {
  if (mcpServer === null) {
    return;
  }

  // Fire-and-forget: don't await, don't throw
  mcpServer.sendLoggingMessage({ level, logger: loggerName, data }).catch(() => {
    // Silently ignore send failures (server may not be connected yet)
  });
}

function log(level: LoggingLevel, loggerName: string, data: unknown): void {
  writeStderr(level, loggerName, data);
  sendMcpLog(level, loggerName, data);
}

/**
 * Create a named logger instance.
 *
 * @param name - Logger name identifying the source module (e.g., 'search', 'cache', 'scraper')
 */
export function createLogger(name: string): Logger {
  return {
    debug: (data: unknown) => { log('debug', name, data); },
    info: (data: unknown) => { log('info', name, data); },
    notice: (data: unknown) => { log('notice', name, data); },
    warning: (data: unknown) => { log('warning', name, data); },
    error: (data: unknown) => { log('error', name, data); },
    critical: (data: unknown) => { log('critical', name, data); },
    alert: (data: unknown) => { log('alert', name, data); },
    emergency: (data: unknown) => { log('emergency', name, data); },
  };
}
