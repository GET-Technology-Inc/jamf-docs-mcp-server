/**
 * Unit tests for progress notification utility (src/utils/progress.ts)
 */

import { describe, it, expect, vi } from 'vitest';
import { reportProgress } from '../../src/utils/progress.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function makeExtra(overrides: Partial<Extra> = {}): Extra {
  return {
    signal: new AbortController().signal,
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn(),
    ...overrides,
  } as unknown as Extra;
}

describe('reportProgress', () => {
  it('should be a no-op when _meta is undefined', async () => {
    const extra = makeExtra({ _meta: undefined });
    await reportProgress(extra, 1, 10);
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should be a no-op when _meta.progressToken is undefined', async () => {
    const extra = makeExtra({ _meta: {} });
    await reportProgress(extra, 1, 10);
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should not send notification without a progressToken (no-op)', async () => {
    const extra = makeExtra({ _meta: { progressToken: undefined } });
    await reportProgress(extra, 5, 10);
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should call sendNotification when progressToken is defined', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, 3, 10);
    expect(extra.sendNotification).toHaveBeenCalledOnce();
  });

  it('should use the correct method "notifications/progress"', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, 3, 10);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.method).toBe('notifications/progress');
  });

  it('should include progressToken, progress, and total in params', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'my-token' } });
    await reportProgress(extra, 5, 20);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params).toEqual({
      progressToken: 'my-token',
      progress: 5,
      total: 20,
    });
  });

  it('should forward the exact progressToken value from _meta', async () => {
    const token = 12345;
    const extra = makeExtra({ _meta: { progressToken: token } });
    await reportProgress(extra, 0, 1);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe(token);
  });

  it('should await sendNotification (resolves without error)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await expect(reportProgress(extra, 1, 1)).resolves.toBeUndefined();
  });

  it('should pass progress value 0 correctly', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, 0, 10);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progress).toBe(0);
    expect(call.params.total).toBe(10);
  });

  it('should pass progress equal to total (100% complete)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, 10, 10);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progress).toBe(10);
    expect(call.params.total).toBe(10);
  });

  it('should send exactly one notification per call', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, 2, 5);
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('should support numeric progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 42 } });
    await reportProgress(extra, 1, 5);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe(42);
  });

  it('should support string progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'task-abc-123' } });
    await reportProgress(extra, 3, 7);
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe('task-abc-123');
  });
});
