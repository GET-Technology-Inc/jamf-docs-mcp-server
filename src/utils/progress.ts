/**
 * Progress notification utility
 */

import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Report progress to the client if a progressToken was provided.
 * No-op if the client didn't request progress notifications.
 */
export async function reportProgress(
  extra: Extra,
  progress: number,
  total: number
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return;
  }

  await extra.sendNotification({
    method: 'notifications/progress',
    params: { progressToken, progress, total },
  });
}
