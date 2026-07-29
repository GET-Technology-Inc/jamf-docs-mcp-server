/**
 * MCP Prompt registration
 */

import type { McpServer } from '@modelcontextprotocol/server';
import { registerTroubleshootPrompt } from './troubleshoot.js';
import { registerSetupGuidePrompt } from './setup-guide.js';
import { registerCompareVersionsPrompt } from './compare-versions.js';

export function registerPrompts(server: McpServer): void {
  registerTroubleshootPrompt(server);
  registerSetupGuidePrompt(server);
  registerCompareVersionsPrompt(server);
}
