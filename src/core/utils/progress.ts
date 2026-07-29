/**
 * Progress notification utility
 */

import type { ServerContext as McpToolContext } from '@modelcontextprotocol/server';

/**
 * The per-request context an MCP handler receives as its last argument.
 *
 * Aliased to keep it distinct from this package's own `ServerContext`
 * (`core/types/context.ts`), which carries our providers and config.
 */
export type { McpToolContext };

export interface ProgressOptions {
  progress: number;
  total: number;
  message?: string;
}

/**
 * Report progress to the client if a progressToken was provided.
 * No-op if the client didn't request progress notifications.
 * Fire-and-forget: notification failures are silently ignored.
 *
 * `notifications/progress` is request-scoped, so it survives the 2026-07-28
 * removal of the server-to-client notification channel: it still travels on
 * the response stream of the request it belongs to.
 */
export async function reportProgress(
  extra: McpToolContext,
  options: ProgressOptions
): Promise<void> {
  const progressToken = extra.mcpReq._meta?.progressToken;
  if (progressToken === undefined) {
    return;
  }

  try {
    await extra.mcpReq.notify({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: options.progress,
        total: options.total,
        ...(options.message !== undefined ? { message: options.message } : {}),
      },
    });
  } catch {
    // Fire-and-forget: do not let notification failures break the tool
  }
}
