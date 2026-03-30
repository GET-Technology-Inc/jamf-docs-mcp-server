/**
 * Logging interfaces for platform abstraction
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Logger instance bound to a specific module name
 */
export interface Logger {
  debug(data: unknown): void;
  info(data: unknown): void;
  notice(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
  critical(data: unknown): void;
  alert(data: unknown): void;
  emergency(data: unknown): void;
}

/**
 * Factory for creating named logger instances
 */
export interface LoggerFactory {
  createLogger(name: string): Logger;
  setServer(server: McpServer): void;
}
