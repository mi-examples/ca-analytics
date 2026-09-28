import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, isActive, shutdown, track } from '../src/core/analytics';
import { createQueue } from '../src/core/queue';
import type { EventRow } from '../src/core/types';

const FLUSH_INTERVAL_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

const row = (event = 'x'): EventRow => ({
  id: 'id',
  ts: '2026-01-01 00:00:00',
  app: 'test-app',
  event,
  session_id: 'sid',
  page_path: '/',
  element_id: 0,
  version: '0.0.0',
  meta: '{}',
});

beforeEach(() => {
  vi.useFakeTimers();
  // Every POST fails with a network error, so every flush retries once and then counts as failed.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))));
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn(() => true) });
});

afterEach(() => {
  shutdown();
  vi.useRealTimers();
});

describe('queue kill-switch', () => {
  it('does not count a flush that finishes after stop()', async () => {
    const onKilled = vi.fn();
    const queue = createQueue('/endpoint', onKilled);

    // Two failed flushes...
    for (let i = 0; i < 2; i += 1) {
      queue.push(row());
      queue.flush();
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    }

    // ...then a third one still waiting on its retry when the queue is stopped.
    queue.push(row());
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    queue.stop();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(onKilled).not.toHaveBeenCalled();
  });

  it('still trips after three consecutive failures while running', async () => {
    const onKilled = vi.fn();
    const queue = createQueue('/endpoint', onKilled);

    for (let i = 0; i < 3; i += 1) {
      queue.push(row());
      queue.flush();
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    }

    expect(onKilled).toHaveBeenCalledTimes(1);
  });
});

describe('shutdown() then init()', () => {
  it('an in-flight flush of the old queue cannot kill the new runtime', async () => {
    init();

    // Each interval tick starts a flush; it fails 2s later, well before the next tick.
    for (let i = 0; i < 3; i += 1) {
      track('tick');
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    }

    // HMR / user switch / StrictMode: restart while the third failing flush waits on its retry.
    shutdown();
    init();
    expect(isActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(isActive()).toBe(true);
  });

  it('the kill-switch still shuts down the runtime that owns the queue', async () => {
    init();

    for (let i = 0; i < 3; i += 1) {
      track('tick');
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    }

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(isActive()).toBe(false);
  });
});
