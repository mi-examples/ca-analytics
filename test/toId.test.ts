import { afterEach, describe, expect, it, vi } from 'vitest';
import { init, shutdown, trackElement } from '../src/core/analytics';
import { createRow, toId } from '../src/core/event';
import type { EventRow } from '../src/core/types';

const INT32_MAX = 2 ** 31 - 1;
const INT32_MIN = -(2 ** 31);

describe('toId', () => {
  it.each([
    [4417, 4417],
    [12.9, 12],
    ['7', 7],
    [INT32_MAX, INT32_MAX],
    [INT32_MIN, INT32_MIN],
    [0, 0],
  ])('keeps an int32 value: %s → %s', (input, expected) => {
    expect(toId(input)).toBe(expected);
  });

  it.each([[1e21], [2 ** 31], [INT32_MIN - 1], [Number.MAX_SAFE_INTEGER], [NaN], [Infinity], ['abc'], [undefined]])(
    'falls back to 0 outside the int column: %s',
    (input) => {
      expect(toId(input)).toBe(0);
    },
  );

  it('never serializes element_id in exponent notation', () => {
    const row = createRow({ app: 'a', event: 'e', sessionId: 's', pagePath: '/', elementId: 1e21 });

    expect(JSON.stringify(row)).toContain('"element_id":0');
  });
});

describe('trackElement', () => {
  afterEach(() => shutdown());

  it('drops an element_id the int column cannot hold', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blobs: Blob[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: (_url: string, data: Blob) => {
        blobs.push(data);
        return true;
      },
    });

    init();
    trackElement({ element_id: 1e21 });
    trackElement({ element_id: 4417 });
    shutdown();

    const rows = (await Promise.all(blobs.map(async (b) => JSON.parse(await b.text()) as EventRow[]))).flat();

    expect(rows.filter((r) => r.event === 'element_click').map((r) => r.element_id)).toEqual([4417]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
