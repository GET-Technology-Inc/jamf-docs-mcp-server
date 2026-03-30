/**
 * jamf_troubleshoot prompt
 * Guides AI through a troubleshooting workflow using Jamf documentation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { completeProduct } from '../completions.js';

export function registerTroubleshootPrompt(server: McpServer): void {
  server.registerPrompt(
    'jamf_troubleshoot',
    {
      title: 'Troubleshoot Jamf Issue',
      description: 'Guide through troubleshooting a Jamf issue using official documentation',
      argsSchema: {
        problem: z.string().max(2000).describe('Description of the issue to troubleshoot'),
        product: completable(
          z.string().optional().describe(
            'Jamf product ID (jamf-pro, jamf-school, jamf-connect, jamf-protect)'
          ),
          completeProduct
        ),
      },
    },
    ({ problem, product }) => {
      const productFilter = product !== undefined && product !== ''
        ? `, product: "${product}"`
        : '';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `I need help troubleshooting a Jamf issue: "${problem}"

Please follow these steps using the Jamf documentation tools:

1. **Search for relevant documentation**
   Use \`jamf_docs_search\` with query based on the problem description${productFilter !== '' ? ` and filter by ${productFilter}` : ''}.

2. **Review the most relevant articles**
   For each promising search result, use \`jamf_docs_get_article\` with \`summaryOnly: true\` to quickly assess relevance.

3. **Deep dive into the solution**
   For the most relevant article(s), use \`jamf_docs_get_article\` with the full content to find specific troubleshooting steps.

4. **Provide a structured diagnosis**
   Based on the documentation, provide:
   - Likely root cause(s)
   - Step-by-step resolution
   - Related articles for further reference

Problem: ${problem}${product !== undefined && product !== '' ? `\nProduct: ${product}` : ''}`,
            },
          },
        ],
      };
    }
  );
}
