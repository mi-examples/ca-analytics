import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, shutdown } from '../src/core/analytics';
import { currentPagePath } from '../src/core/config';
import { startPageView, type PageViewSignal } from '../src/core/signals/pageview';
import type { EventRow } from '../src/core/types';

const ROOT = '/p/test-app/';

/** Waits for the tasks jsdom queues for a fragment navigation (hashchange, popstate). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let signal: PageViewSignal | undefined;
let paths: string[];

beforeEach(() => {
  window.history.replaceState(null, '', ROOT);
  paths = [];
});

afterEach(() => {
  signal?.stop();
  signal = undefined;
  shutdown();
  window.history.replaceState(null, '', ROOT);
});

const start = () => {
  signal = startPageView((path) => paths.push(path), currentPagePath);
};

describe('currentPagePath with hash routing', () => {
  it.each([
    ['/p/test-app/#/reports', '/reports'],
    ['/p/test-app/#/reports/42?tab=1', '/reports/42'],
    ['/p/test-app/#/', '/'],
    ['/p/test-app/#/?tab=1', '/'],
    ['/p/test-app/sub#/reports', '/reports'],
    ['/p/test-app/sub', '/sub'],
    ['/p/test-app/sub#section', '/sub'],
    ['/p/test-app/#section', '/'],
  ])('%s → %s', (url, expected) => {
    window.history.replaceState(null, '', url);

    expect(currentPagePath()).toBe(expected);
  });
});

describe('page_view with hash routing', () => {
  it('a pushState between hash routes is a new view, not deduped away', () => {
    start();
    window.history.pushState(null, '', '#/reports');
    window.history.pushState(null, '', '#/reports?tab=2');

    expect(paths).toEqual(['/', '/reports', '/reports']);
  });

  it('emits on location.hash navigation, once', async () => {
    start();
    window.location.hash = '#/settings';
    await settle();

    expect(paths).toEqual(['/', '/settings']);
  });

  it('emits on a hashchange event alone', () => {
    start();
    // Bypass the history patch and popstate: only the hashchange listener can see this one.
    History.prototype.replaceState.call(window.history, null, '', '#/settings');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(paths).toEqual(['/', '/settings']);
  });

  it('a plain in-page anchor does not create a page view', async () => {
    start();
    window.location.hash = '#section';
    await settle();
    window.history.pushState(null, '', '#other');

    expect(paths).toEqual(['/']);
  });

  it('stop() removes the hashchange listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    start();
    const listener = add.mock.calls.find(([type]) => type === 'hashchange')?.[1];
    signal?.stop();

    expect(listener).toBeTypeOf('function');
    expect(remove).toHaveBeenCalledWith('hashchange', listener);
  });

  it('page_view rows carry the hash route as page_path and its query in meta.query', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: (_url: string, data: Blob) => {
        blobs.push(data);
        return true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    window.history.replaceState(null, '', '/p/test-app/?embed=1#/reports?tab=2');

    init();
    window.location.hash = '#/settings';
    await settle();
    shutdown();

    const rows = (await Promise.all(blobs.map(async (b) => JSON.parse(await b.text()) as EventRow[]))).flat();
    const views = rows.filter((r) => r.event === 'page_view');

    expect(views.map((r) => r.page_path)).toEqual(['/reports', '/settings']);
    expect(views.map((r) => JSON.parse(r.meta) as { query: string; referrer: string })).toEqual([
      { referrer: '', query: 'embed=1&tab=2' },
      { referrer: '/reports', query: 'embed=1' },
    ]);
  });
});
