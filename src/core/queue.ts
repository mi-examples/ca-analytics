import { send, sendOnUnload } from './transport';
import type { SendOutcome } from './transport';
import type { EventRow } from './types';

/** A row's JSON already computed once in push(); send() joins these into the array body instead of re-stringifying. */
type Buffered = { json: string; size: number };

const FLUSH_INTERVAL_MS = 15_000;
const MAX_FLUSH_ROWS = 50;
/** Half of sendBeacon's 64 KiB cumulative quota. The server has no practical ceiling. */
const MAX_FLUSH_BYTES = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

// Counts encoded UTF-8 bytes, not UTF-16 code units — what sendBeacon actually charges against its quota.
const textEncoder = new TextEncoder();

export interface Queue {
  push(row: EventRow): void;
  flush(): void;
  flushOnUnload(): void;
  stop(): void;
}

/** Splits rows into batches whose `[a,b,c]` body stays within maxBytes. A lone row over the limit still goes, alone. */
function chunkBySize(rows: Buffered[], maxBytes: number): Buffered[][] {
  const chunks: Buffered[][] = [];
  let current: Buffered[] = [];
  let size = 2;

  for (const row of rows) {
    if (current.length > 0 && size + 1 + row.size > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }

    size += (current.length > 0 ? 1 : 0) + row.size;
    current.push(row);
  }

  if (current.length > 0) chunks.push(current);

  return chunks;
}

export function createQueue(endpoint: string, onKilled?: () => void): Queue {
  let buffer: Buffered[] = [];
  let bytes = 0;
  let failures = 0;
  let stopped = false;
  let inFlight = false;
  // Guards re-entrancy: onKilled calls shutdown() -> stop() again, but the kill must fire once.
  let killed = false;

  const timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  function stop(): void {
    stopped = true;
    buffer = [];
    bytes = 0;
    clearInterval(timer);
  }

  async function flush(): Promise<void> {
    if (stopped || inFlight || buffer.length === 0) return;

    const batch = buffer;

    buffer = [];
    bytes = 0;
    inFlight = true;

    try {
      let outcome: SendOutcome;

      // send() isn't expected to reject, but a rejection must not become an unhandled promise rejection.
      try {
        outcome = await send(
          endpoint,
          batch.map((b) => b.json),
        );
      } catch {
        outcome = 'failed';
      }

      // Stopped while the request was out: a stale result must not count toward, or trip, the kill-switch.
      if (stopped) return;

      if (outcome === 'ok') {
        failures = 0;
        return;
      }

      failures += 1;

      // Batch dropped, not re-buffered: transport already retried once, and re-sending a batch whose
      // response was merely lost is what creates duplicates.
      if (failures >= MAX_CONSECUTIVE_FAILURES && !killed) {
        killed = true;
        stop();

        // Hand the kill up to the owner so it can stop the timers/listeners still producing rows.
        try {
          onKilled?.();
        } catch {
          // swallowed — a host callback must never escape
        }
      }
    } finally {
      inFlight = false;

      // push() only flushes on its own threshold check, which is a no-op while a request is out; rows
      // that piled up meanwhile would otherwise wait for the timer and could outgrow the beacon quota.
      if (!stopped && (buffer.length >= MAX_FLUSH_ROWS || bytes >= MAX_FLUSH_BYTES)) void flush();
    }
  }

  return {
    push(row: EventRow): void {
      if (stopped) return;

      let json: string;

      try {
        json = JSON.stringify(row);
      } catch {
        return;
      }

      const size = textEncoder.encode(json).length;

      buffer.push({ json, size });
      bytes += size;

      if (buffer.length >= MAX_FLUSH_ROWS || bytes >= MAX_FLUSH_BYTES) void flush();
    },
    flush(): void {
      void flush();
    },
    flushOnUnload(): void {
      if (stopped || buffer.length === 0) return;

      const batch = buffer;

      buffer = [];
      bytes = 0;

      // One body over the 64 KiB quota fails in both sendBeacon and keepalive fetch and drops every row;
      // flush-sized chunks let at least the ones that fit through.
      for (const chunk of chunkBySize(batch, MAX_FLUSH_BYTES)) {
        sendOnUnload(
          endpoint,
          chunk.map((b) => b.json),
        );
      }
    },
    stop,
  };
}
