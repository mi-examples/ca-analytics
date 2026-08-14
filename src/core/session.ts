const SID_KEY = 'ca_pa_sid';
const LAST_KEY = 'ca_pa_last';
const IDLE_MS = 30 * 60 * 1000;
const TOUCH_THROTTLE_MS = 5000;

let memoryId: string | null = null;
let lastWrittenAt = 0;

/** Safari private mode and blocked-storage policies throw on access, not just on write. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // In-memory session for the page lifetime beats no tracking.
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}

  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Clears in-memory state only. Storage stays, so a reload still finds the session. */
export function resetSession(): void {
  memoryId = null;
  lastWrittenAt = 0;
}

/** Session id, minting a new one after 30 min idle. Extends the window on every call. */
export function getSessionId(): string {
  const now = Date.now();
  const storedId = read(SID_KEY);
  const rawLast = read(LAST_KEY);
  const last = rawLast === null ? Number.NaN : Number(rawLast);
  const alive = Number.isFinite(last) && now - last <= IDLE_MS;

  let id: string;

  if (storedId && alive) {
    // Trusting storage here is what survives a reload.
    id = storedId;
  } else if (!storedId && memoryId) {
    // Blocked localStorage always reads null; reusing the memory id is the only stable fallback.
    id = memoryId;
  } else {
    id = newId();
    write(SID_KEY, id);
    lastWrittenAt = 0;
  }

  memoryId = id;

  if (now - lastWrittenAt >= TOUCH_THROTTLE_MS) {
    write(LAST_KEY, String(now));
    lastWrittenAt = now;
  }

  return id;
}
