import { VERSION, WIDTHS } from './constants';
import type { EventRow } from './types';

export interface RowInput {
  app: string;
  event: string;
  sessionId: string;
  pagePath: string;
  elementId?: number;
  meta?: Record<string, unknown>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Integer only: a float or string value widens the `int` column permanently. */
export function toId(value: unknown): number {
  const n = Number(value);

  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Space-separated, never ISO — a `T`/`Z` sniffs as text and the column stops being `datetime`. */
export function formatTs(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  );
}

function stringify(value: unknown): string | null {
  try {
    const out = JSON.stringify(value);

    return typeof out === 'string' ? out : null;
  } catch {
    return null;
  }
}

/** JSON string capped at WIDTHS.meta. Drops whole keys instead of slicing — a sliced payload is invalid JSON. */
export function serializeMeta(meta?: Record<string, unknown>): string {
  if (!meta) return '{}';

  const full = stringify(meta);

  if (full !== null && full.length <= WIDTHS.meta) return full;

  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    const candidate = stringify({ ...kept, [key]: value, _truncated: 1 });

    if (candidate === null || candidate.length > WIDTHS.meta) continue;

    kept[key] = value;
  }

  return stringify({ ...kept, _truncated: 1 }) ?? '{}';
}

export function uuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;

  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  // Older Safari has getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16);

  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Only place a row is built. `ts`/`element_id` type mistakes here lock the shared dataset's schema permanently. */
export function createRow(input: RowInput): EventRow {
  return {
    id: uuid(),
    ts: formatTs(new Date()),
    app: input.app.slice(0, WIDTHS.app),
    event: input.event.slice(0, WIDTHS.event),
    session_id: input.sessionId.slice(0, 36),
    page_path: input.pagePath.slice(0, WIDTHS.page_path),
    element_id: toId(input.elementId),
    version: VERSION.slice(0, WIDTHS.version),
    meta: serializeMeta(input.meta),
  };
}
