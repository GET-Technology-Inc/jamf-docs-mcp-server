/**
 * Node.js logger factory
 *
 * Wraps a LoggingService instance to implement the LoggerFactory interface.
 * Each NodeLoggerFactory holds its own LoggingService, avoiding
 * module-level mutable state.
 *
 * Uses `console.error` (stderr) by default — the standard Node.js behaviour.
 * A future WorkersLoggerFactory could pass `console.log` or a no-op instead.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger, LoggerFactory, WriteStderrFn } from '../../core/services/interfaces/index.js';
import { LoggingService } from '../../core/services/logging.js';

export class NodeLoggerFactory implements LoggerFactory {
  private readonly service: LoggingService;

  /**
   * @param writeStderr - Optional writer function. Defaults to `console.error`
   *   (Node.js stderr). Override for testing or alternative output targets.
   */
  constructor(writeStderr?: WriteStderrFn) {
    this.service = new LoggingService(writeStderr);
  }

  createLogger(name: string): Logger {
    return this.service.createLogger(name);
  }

  setServer(server: McpServer): void {
    this.service.setServer(server);
  }
}
