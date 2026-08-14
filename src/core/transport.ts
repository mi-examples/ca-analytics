export type SendOutcome = 'ok' | 'failed';

const RETRY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rows arrive pre-serialized; joining as `[a,b,c]` matches JSON.stringify(rows) byte-for-byte without a second pass. */
const toArrayBody = (rows: string[]): string => `[${rows.join(',')}]`;

async function post(endpoint: string, body: string): Promise<{ ok: boolean; retryable: boolean }> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      return { ok: false, retryable: response.status === 429 || response.status >= 500 };
    }

    const payload = (await response.json().catch(() => null)) as { resultCode?: number } | null;

    // 200 with a non-zero resultCode is a rejected insert, not a success.
    if (payload && typeof payload.resultCode === 'number' && payload.resultCode !== 0) {
      return { ok: false, retryable: false };
    }

    return { ok: true, retryable: false };
  } catch {
    return { ok: false, retryable: true };
  }
}

/** One retry max, same rows — a lost-response double-insert is caught by readers using COUNT(DISTINCT id). */
export async function send(endpoint: string, rows: string[]): Promise<SendOutcome> {
  if (rows.length === 0) return 'ok';

  const body = toArrayBody(rows);
  const first = await post(endpoint, body);

  if (first.ok) return 'ok';
  if (!first.retryable) return 'failed';

  await sleep(RETRY_DELAY_MS);

  return (await post(endpoint, body)).ok ? 'ok' : 'failed';
}

/** Unload path. No retry possible — the page is going away. */
export function sendOnUnload(endpoint: string, rows: string[]): void {
  if (rows.length === 0) return;

  const body = toArrayBody(rows);

  try {
    const blob = new Blob([body], { type: 'application/json' });

    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
  } catch {
    // fall through to keepalive fetch
  }

  try {
    void fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // Dropped. Nothing further possible at unload.
  }
}
