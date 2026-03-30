/**
 * Unit tests for progress notification utility (src/utils/progress.ts)
 */

import { describe, it, expect, vi } from 'vitest';
import { reportProgress } from '../../src/core/utils/progress.js';
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
    await reportProgress(extra, { progress: 1, total: 10 });
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should be a no-op when _meta.progressToken is undefined', async () => {
    const extra = makeExtra({ _meta: {} });
    await reportProgress(extra, { progress: 1, total: 10 });
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should not send notification without a progressToken (no-op)', async () => {
    const extra = makeExtra({ _meta: { progressToken: undefined } });
    await reportProgress(extra, { progress: 5, total: 10 });
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  it('should call sendNotification when progressToken is defined', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, { progress: 3, total: 10 });
    expect(extra.sendNotification).toHaveBeenCalledOnce();
  });

  it('should use the correct method "notifications/progress"', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, { progress: 3, total: 10 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.method).toBe('notifications/progress');
  });

  it('should include progressToken, progress, and total in params', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'my-token' } });
    await reportProgress(extra, { progress: 5, total: 20 });
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
    await reportProgress(extra, { progress: 0, total: 1 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe(token);
  });

  it('should await sendNotification (resolves without error)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await expect(reportProgress(extra, { progress: 1, total: 1 })).resolves.toBeUndefined();
  });

  it('should pass progress value 0 correctly', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 0, total: 10 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progress).toBe(0);
    expect(call.params.total).toBe(10);
  });

  it('should pass progress equal to total (100% complete)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 10, total: 10 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progress).toBe(10);
    expect(call.params.total).toBe(10);
  });

  it('should send exactly one notification per call', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 2, total: 5 });
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('should support numeric progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 42 } });
    await reportProgress(extra, { progress: 1, total: 5 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe(42);
  });

  it('should support string progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'task-abc-123' } });
    await reportProgress(extra, { progress: 3, total: 7 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.progressToken).toBe('task-abc-123');
  });

  // --- message support ---

  it('should include message in params when provided', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 1, total: 4, message: 'Fetching article...' });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params.message).toBe('Fetching article...');
  });

  it('should not include message field when omitted', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 1, total: 4 });
    const call = (extra.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.params).not.toHaveProperty('message');
  });

  it('should be a no-op with message when no progressToken', async () => {
    const extra = makeExtra({ _meta: {} });
    await reportProgress(extra, { progress: 1, total: 4, message: 'test' });
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });

  // --- fire-and-forget resilience ---

  it('should not throw when sendNotification rejects', async () => {
    const extra = makeExtra({
      _meta: { progressToken: 'tok' },
      sendNotification: vi.fn().mockRejectedValue(new Error('send failed')),
    });
    await expect(reportProgress(extra, { progress: 1, total: 3 })).resolves.toBeUndefined();
  });

  it('should not throw when sendNotification throws synchronously', async () => {
    const extra = makeExtra({
      _meta: { progressToken: 'tok' },
      sendNotification: vi.fn().mockImplementation(() => {
        throw new Error('sync failure');
      }),
    });
    await expect(reportProgress(extra, { progress: 1, total: 3 })).resolves.toBeUndefined();
  });
});
