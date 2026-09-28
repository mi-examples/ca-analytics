import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueue, type Queue } from '../src/core/queue';
import type { EventRow } from '../src/core/types';

const MAX_FLUSH_BYTES = 30_000;

/** A row of roughly 1 KB once serialized. */
const bigRow = (n: number): EventRow => ({
  id: `id-${n}`,
  ts: '2026-01-01 00:00:00',
  app: 'test-app',
  event: 'x',
  session_id: 'sid',
  page_path: '/',
  element_id: 0,
  version: '0.0.0',
  meta: JSON.stringify({ pad: 'p'.repeat(900) }),
});

const okResponse = () => ({ ok: true, status: 200, json: async () => ({ resultCode: 0 }) });

let queue: Queue | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  queue?.stop();
  queue = undefined;
  vi.useRealTimers();
});

describe('queue thresholds', () => {
  it('flushes again as soon as an in-flight request ends if the buffer is still over a threshold', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal('fetch', fetchMock);

    queue = createQueue('/endpoint');

    // About 30 of these rows trip the byte threshold: the first request goes out and stays in flight.
    for (let i = 0; i < 50; i += 1) queue.push(bigRow(i));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A burst while it is out: over the thresholds, but flush() is blocked by the in-flight request.
    for (let i = 50; i < 110; i += 1) queue.push(bigRow(i));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending[0](okResponse());
    // Microtasks only; the 15 s interval must not be what sends the burst.
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as EventRow[],
    );
    // Everything not in the first request goes out in the second.
    expect(bodies[0].length + bodies[1].length).toBe(110);
  });

  it('does not re-flush straight after a failed request, so a brief outage does not spend the kill-switch', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal('fetch', fetchMock);

    queue = createQueue('/endpoint');

    for (let i = 0; i < 50; i += 1) queue.push(bigRow(i));
    for (let i = 50; i < 110; i += 1) queue.push(bigRow(i));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 400 is not retried by the transport, so this is one failed flush.
    pending[0]({ ok: false, status: 400, json: async () => ({}) });
    await vi.advanceTimersByTimeAsync(0);

    // Still over the thresholds, but the next attempt waits for the interval.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('flushOnUnload splits a large buffer into beacons no larger than the flush byte limit', async () => {
    // First request never settles, so everything pushed afterwards stays buffered.
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const blobs: Blob[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: vi.fn((_url: string, data: Blob) => {
        blobs.push(data);
        return true;
      }),
    });

    queue = createQueue('/endpoint');

    for (let i = 0; i < 200; i += 1) queue.push(bigRow(i));

    queue.flushOnUnload();

    expect(blobs.length).toBeGreaterThan(1);

    const ids: string[] = [];

    for (const blob of blobs) {
      expect(blob.size).toBeLessThanOrEqual(MAX_FLUSH_BYTES);

      const rows = JSON.parse(await blob.text()) as EventRow[];

      ids.push(...rows.map((r) => r.id));
    }

    // Every row not already in the in-flight request goes out exactly once, in order.
    const inFlight = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as EventRow[];
    const all = Array.from({ length: 200 }, (_, i) => `id-${i}`);

    expect(ids).toEqual(all.slice(inFlight.length));
  });
});
