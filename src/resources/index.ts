/**
 * MCP Resources registration
 *
 * Exposes dynamic reference data for AI clients to read directly
 * without needing to call tools. Data is fetched from the API
 * with fallback to static constants.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getProductsResourceData,
  getTopicsResourceData
} from '../services/metadata.js';

/**
 * Register all MCP resources
 */
export function registerResources(server: McpServer): void {
  // Products resource - dynamic with fallback
  server.registerResource(
    'products',
    'jamf://products',
    {
      title: 'Jamf Products List',
      description: 'List of all available Jamf products (Jamf Pro, Jamf School, Jamf Connect, Jamf Protect) with their IDs and latest versions. Data is fetched dynamically from the API.',
      mimeType: 'application/json'
    },
    async () => {
      const data = await getProductsResourceData();
      return {
        contents: [{
          uri: 'jamf://products',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2)
        }]
      };
    }
  );

  // Topics resource - dynamic with fallback
  server.registerResource(
    'topics',
    'jamf://topics',
    {
      title: 'Jamf Documentation Topics',
      description: 'Topic categories for filtering documentation searches. Combines official TOC structure with curated categories.',
      mimeType: 'application/json'
    },
    async () => {
      const data = await getTopicsResourceData();
      return {
        contents: [{
          uri: 'jamf://topics',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2)
        }]
      };
    }
  );

  console.error('Registered resources: jamf://products, jamf://topics');
}
