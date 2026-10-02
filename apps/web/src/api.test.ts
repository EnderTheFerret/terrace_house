import { expect, it, vi } from 'vitest';
import { api, waitImage } from './api';

it('reports terminal image failures so portrait controls stop waiting', async () => {
  vi.useFakeTimers();
  const poll = vi.spyOn(api, 'imageStatus').mockRejectedValue(new Error('offline'));
  try {
    const update = vi.fn();
    const pending = waitImage({ key: 'portrait', status: 'queued' }, update);
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(update).toHaveBeenCalledWith({ key: 'portrait', status: 'failed' });
    update.mockClear();
    await waitImage({ key: 'portrait', status: 'cancelled' }, update);
    expect(update).toHaveBeenCalledWith({ key: 'portrait', status: 'cancelled' });
    update.mockClear();
    const ac = new AbortController();
    ac.abort();
    await waitImage({ key: 'portrait', status: 'ready' }, update, ac.signal);
    expect(update).not.toHaveBeenCalled();
  } finally {
    poll.mockRestore();
    vi.useRealTimers();
  }
});
