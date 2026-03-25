/**
 * jamf_setup_guide prompt
 * Guides AI through creating a setup guide from Jamf documentation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { completeProduct } from '../completions.js';

export function registerSetupGuidePrompt(server: McpServer): void {
  server.registerPrompt(
    'jamf_setup_guide',
    {
      title: 'Jamf Setup Guide',
      description:
        'Generate a step-by-step setup guide for a Jamf feature using official documentation',
      argsSchema: {
        feature: z.string().max(2000).describe('The feature or capability to set up'),
        product: completable(
          z.string().optional().describe(
            'Jamf product ID (jamf-pro, jamf-school, jamf-connect, jamf-protect)'
          ),
          completeProduct
        ),
      },
    },
    ({ feature, product }) => {
      const productFilter = product !== undefined && product !== ''
        ? `, product: "${product}"`
        : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `I need a step-by-step setup guide for: "${feature}"

Please follow these steps using the Jamf documentation tools:

1. **Search for setup documentation**
   Use \`jamf_docs_search\` with query related to "${feature}" setup/configuration${productFilter !== '' ? ` and filter by ${productFilter}` : ''}.

2. **Find the primary setup article**
   Review search results and use \`jamf_docs_get_article\` with \`summaryOnly: true\` to identify the main setup/configuration article.

3. **Extract detailed steps**
   Use \`jamf_docs_get_article\` to get the full content of the primary article. If it's long, use the \`section\` parameter to fetch specific sections like "Prerequisites" or "Configuration".

4. **Compile the setup guide**
   Based on the documentation, provide:
   - Prerequisites and requirements
   - Step-by-step setup instructions
   - Configuration options and recommendations
   - Verification steps to confirm successful setup

Feature: ${feature}${product !== undefined && product !== '' ? `\nProduct: ${product}` : ''}`,
            },
          },
        ],
      };
    }
  );
}
