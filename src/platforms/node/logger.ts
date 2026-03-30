/**
 * Node.js logger factory
 *
 * Wraps the existing logging implementation from core to implement LoggerFactory.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger, LoggerFactory } from '../../core/services/interfaces/index.js';
import {
  createLogger as coreCreateLogger,
  setServer as coreSetServer,
} from '../../core/services/logging.js';

export class NodeLoggerFactory implements LoggerFactory {
  createLogger(name: string): Logger {
    return coreCreateLogger(name);
  }

  setServer(server: McpServer): void {
    coreSetServer(server);
  }
}
