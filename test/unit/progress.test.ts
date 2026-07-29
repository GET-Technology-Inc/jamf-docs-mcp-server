/**
 * Unit tests for progress notification utility (src/utils/progress.ts)
 */

import { describe, it, expect, vi } from 'vitest';
import { reportProgress, type McpToolContext } from '../../src/core/utils/progress.js';

type Extra = McpToolContext;

interface ExtraOverrides {
  _meta?: Record<string, unknown>;
  notify?: (notification: unknown) => unknown;
}

/**
 * Build a per-request handler context. Progress metadata and the outbound
 * notification channel live under `ctx.mcpReq` from SDK v2 onwards.
 */
function makeExtra(overrides: ExtraOverrides = {}): Extra {
  return {
    mcpReq: {
      signal: new AbortController().signal,
      _meta: overrides._meta,
      notify: overrides.notify ?? vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    },
  } as unknown as Extra;
}

/** The `notify` spy installed by {@link makeExtra}. */
function notifyOf(extra: Extra): ReturnType<typeof vi.fn> {
  return extra.mcpReq.notify as unknown as ReturnType<typeof vi.fn>;
}

describe('reportProgress', () => {
  it('should be a no-op when _meta is undefined', async () => {
    const extra = makeExtra({ _meta: undefined });
    await reportProgress(extra, { progress: 1, total: 10 });
    expect(notifyOf(extra)).not.toHaveBeenCalled();
  });

  it('should be a no-op when _meta.progressToken is undefined', async () => {
    const extra = makeExtra({ _meta: {} });
    await reportProgress(extra, { progress: 1, total: 10 });
    expect(notifyOf(extra)).not.toHaveBeenCalled();
  });

  it('should not send notification without a progressToken (no-op)', async () => {
    const extra = makeExtra({ _meta: { progressToken: undefined } });
    await reportProgress(extra, { progress: 5, total: 10 });
    expect(notifyOf(extra)).not.toHaveBeenCalled();
  });

  it('should call notify when progressToken is defined', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, { progress: 3, total: 10 });
    expect(notifyOf(extra)).toHaveBeenCalledOnce();
  });

  it('should use the correct method "notifications/progress"', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok-42' } });
    await reportProgress(extra, { progress: 3, total: 10 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.method).toBe('notifications/progress');
  });

  it('should include progressToken, progress, and total in params', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'my-token' } });
    await reportProgress(extra, { progress: 5, total: 20 });
    const call = notifyOf(extra).mock.calls[0][0];
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
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.progressToken).toBe(token);
  });

  it('should await notify (resolves without error)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await expect(reportProgress(extra, { progress: 1, total: 1 })).resolves.toBeUndefined();
  });

  it('should pass progress value 0 correctly', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 0, total: 10 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.progress).toBe(0);
    expect(call.params.total).toBe(10);
  });

  it('should pass progress equal to total (100% complete)', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 10, total: 10 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.progress).toBe(10);
    expect(call.params.total).toBe(10);
  });

  it('should send exactly one notification per call', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 2, total: 5 });
    expect(notifyOf(extra)).toHaveBeenCalledTimes(1);
  });

  it('should support numeric progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 42 } });
    await reportProgress(extra, { progress: 1, total: 5 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.progressToken).toBe(42);
  });

  it('should support string progressToken', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'task-abc-123' } });
    await reportProgress(extra, { progress: 3, total: 7 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.progressToken).toBe('task-abc-123');
  });

  // --- message support ---

  it('should include message in params when provided', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 1, total: 4, message: 'Fetching article...' });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params.message).toBe('Fetching article...');
  });

  it('should not include message field when omitted', async () => {
    const extra = makeExtra({ _meta: { progressToken: 'tok' } });
    await reportProgress(extra, { progress: 1, total: 4 });
    const call = notifyOf(extra).mock.calls[0][0];
    expect(call.params).not.toHaveProperty('message');
  });

  it('should be a no-op with message when no progressToken', async () => {
    const extra = makeExtra({ _meta: {} });
    await reportProgress(extra, { progress: 1, total: 4, message: 'test' });
    expect(notifyOf(extra)).not.toHaveBeenCalled();
  });

  // --- fire-and-forget resilience ---

  it('should not throw when notify rejects', async () => {
    const extra = makeExtra({
      _meta: { progressToken: 'tok' },
      notify: vi.fn().mockRejectedValue(new Error('send failed')),
    });
    await expect(reportProgress(extra, { progress: 1, total: 3 })).resolves.toBeUndefined();
  });

  it('should not throw when notify throws synchronously', async () => {
    const extra = makeExtra({
      _meta: { progressToken: 'tok' },
      notify: vi.fn().mockImplementation(() => {
        throw new Error('sync failure');
      }),
    });
    await expect(reportProgress(extra, { progress: 1, total: 3 })).resolves.toBeUndefined();
  });
});
