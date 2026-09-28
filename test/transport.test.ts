import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendOnUnload } from '../src/core/transport';

// Node global, typed locally rather than pulling in @types/node for one listener.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

describe('sendOnUnload', () => {
  const unhandled = vi.fn();

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
    unhandled.mockReset();
  });

  it('a rejected keepalive fetch does not become an unhandled rejection', async () => {
    process.on('unhandledRejection', unhandled);
    // No sendBeacon, so the keepalive fetch fallback runs, and it rejects (e.g. over the 64 KiB quota).
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
    // A plain function, not vi.fn(): vitest attaches handlers to promises a mock returns, which would hide the bug.
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    sendOnUnload('/endpoint', ['{"a":1}']);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toEqual([expect.objectContaining({ keepalive: true, body: '[{"a":1}]' })]);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('uses sendBeacon when it accepts the payload', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    sendOnUnload('/endpoint', ['{"a":1}']);

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
