/**
 * Progress notification utility
 */

import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ProgressOptions {
  progress: number;
  total: number;
  message?: string;
}

/**
 * Report progress to the client if a progressToken was provided.
 * No-op if the client didn't request progress notifications.
 * Fire-and-forget: notification failures are silently ignored.
 */
export async function reportProgress(
  extra: Extra,
  options: ProgressOptions
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return;
  }

  try {
    await extra.sendNotification({
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
