/**
 * MCP Prompt registration
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTroubleshootPrompt } from './troubleshoot.js';
import { registerSetupGuidePrompt } from './setup-guide.js';
import { registerCompareVersionsPrompt } from './compare-versions.js';

export function registerPrompts(server: McpServer): void {
  registerTroubleshootPrompt(server);
  registerSetupGuidePrompt(server);
  registerCompareVersionsPrompt(server);
}
