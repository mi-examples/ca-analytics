import { describe, expect, it } from 'vitest';
import { createRow, formatTs, serializeMeta } from '../src/core/event';

describe('createRow', () => {
  it('builds the nine-key row with a space-separated UTC ts', () => {
    const row = createRow({ app: 'my-app', event: 'tile_clicked', sessionId: 'sid', pagePath: '/', meta: { a: 1 } });

    expect(Object.keys(row).sort()).toEqual(
      ['app', 'element_id', 'event', 'id', 'meta', 'page_path', 'session_id', 'ts', 'version'].sort(),
    );
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.element_id).toBe(0);
    expect(row.meta).toBe('{"a":1}');
  });

  it('formats ts in UTC, never ISO', () => {
    expect(formatTs(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02 03:04:05');
  });
});

describe('serializeMeta', () => {
  it('drops whole keys past the cap and stamps _truncated', () => {
    const out = serializeMeta({ small: 'x', big: 'y'.repeat(3000) });

    expect(JSON.parse(out)).toEqual({ small: 'x', _truncated: 1 });
  });
});
