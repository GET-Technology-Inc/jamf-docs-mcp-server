/**
 * MCP Resources registration
 *
 * Exposes dynamic reference data for AI clients to read directly
 * without needing to call tools. Data is fetched from the API
 * with fallback to static constants.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../services/logging.js';
import { JAMF_PRODUCTS, type ProductId } from '../constants.js';
import {
  getProductsResourceData,
  getTopicsResourceData,
  getAvailableVersions
} from '../services/metadata.js';
import { fetchTableOfContents } from '../services/scraper.js';
import { completeProduct } from '../completions.js';

const log = createLogger('resources');

function validateProductId(
  productId: string | string[] | number | undefined,
  uri: URL
): { valid: true; id: ProductId } | { valid: false; errorResponse: { contents: { uri: string; mimeType: string; text: string }[] } } {
  const productIdStr = String(productId);
  if (productIdStr in JAMF_PRODUCTS) {
    return { valid: true, id: productIdStr as ProductId };
  }
  const validIds = Object.keys(JAMF_PRODUCTS).join(', ');
  return {
    valid: false,
    errorResponse: {
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: `Invalid product ID: "${productIdStr}". Valid products: ${validIds}`,
      }],
    },
  };
}

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

  // Resource template: Product-specific TOC
  server.registerResource(
    'product-toc',
    new ResourceTemplate('jamf://products/{productId}/toc', {
      list: undefined,
      complete: { productId: completeProduct },
    }),
    {
      title: 'Product Table of Contents',
      description: 'Table of contents for a specific Jamf product documentation',
      mimeType: 'application/json',
    },
    async (uri, { productId }) => {
      const validation = validateProductId(productId, uri);
      if (!validation.valid) {
        return validation.errorResponse;
      }

      const tocResult = await fetchTableOfContents(validation.id, 'current', {
        maxTokens: 20000,
      });
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            product: JAMF_PRODUCTS[validation.id].name,
            totalEntries: tocResult.pagination.totalItems,
            toc: tocResult.toc,
          }, null, 2),
        }],
      };
    }
  );

  // Resource template: Product-specific versions
  server.registerResource(
    'product-versions',
    new ResourceTemplate('jamf://products/{productId}/versions', {
      list: undefined,
      complete: { productId: completeProduct },
    }),
    {
      title: 'Product Documentation Versions',
      description: 'Available documentation versions for a specific Jamf product',
      mimeType: 'application/json',
    },
    async (uri, { productId }) => {
      const validation = validateProductId(productId, uri);
      if (!validation.valid) {
        return validation.errorResponse;
      }

      const versions = await getAvailableVersions(validation.id);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            product: JAMF_PRODUCTS[validation.id].name,
            productId: validation.id,
            versions,
            latestVersion: JAMF_PRODUCTS[validation.id].latestVersion,
          }, null, 2),
        }],
      };
    }
  );

  log.info('Registered resources: jamf://products, jamf://topics, jamf://products/{productId}/toc, jamf://products/{productId}/versions');
}
