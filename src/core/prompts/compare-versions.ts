/**
 * jamf_compare_versions prompt
 * Guides AI through comparing documentation between two versions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { completeProduct } from '../completions.js';

export function registerCompareVersionsPrompt(server: McpServer): void {
  server.registerPrompt(
    'jamf_compare_versions',
    {
      title: 'Compare Jamf Versions',
      description:
        'Compare documentation between two versions of a Jamf product to identify changes',
      argsSchema: {
        product: completable(
          z.string().max(100).describe(
            'Jamf product ID (jamf-pro, jamf-school, jamf-connect, jamf-protect)'
          ),
          completeProduct
        ),
        version_a: z.string().max(50).describe('First version to compare (e.g., "11.5.0")'),
        version_b: z.string().max(50).describe('Second version to compare (e.g., "11.12.0")'),
      },
    },
    ({ product, version_a: versionA, version_b: versionB }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `I need to compare what changed between version ${versionA} and ${versionB} of ${product}.

Please follow these steps using the Jamf documentation tools:

1. **Get the table of contents for both versions**
   Use \`jamf_docs_get_toc\` with product="${product}" and version="${versionA}", then again with version="${versionB}".

2. **Identify structural differences**
   Compare the two TOC structures to find:
   - New sections added in ${versionB}
   - Sections removed from ${versionA}
   - Sections that may have been renamed or reorganized

3. **Review key changed articles**
   For significant changes, use \`jamf_docs_get_article\` with \`summaryOnly: true\` to understand what's new or different.

4. **Summarize the changes**
   Provide a structured comparison:
   - New features/capabilities in ${versionB}
   - Removed or deprecated features
   - Notable changes to existing functionality
   - Migration considerations

Product: ${product}
Version A: ${versionA}
Version B: ${versionB}`,
            },
          },
        ],
      };
    }
  );
}
