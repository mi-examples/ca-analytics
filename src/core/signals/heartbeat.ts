export const HEARTBEAT_FAST_MS = 60_000;
export const HEARTBEAT_SLOW_MS = 300_000;
export const HEARTBEAT_FAST_COUNT = 5;

/** Tapered, visible-only — readers derive engaged time as beats x interval, so a hidden beat would count idle time. */
export function startHeartbeat(emit: () => void): { stop(): void } {
  let beats = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const interval = () => (beats < HEARTBEAT_FAST_COUNT ? HEARTBEAT_FAST_MS : HEARTBEAT_SLOW_MS);

  function schedule(): void {
    if (stopped || timer !== undefined) return;

    timer = setTimeout(() => {
      timer = undefined;

      if (stopped || document.visibilityState !== 'visible') return;

      beats += 1;

      try {
        emit();
      } catch {
        // A failed emit must not stop the timer.
      }

      schedule();
    }, interval());
  }

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  const onVisibilityChange = () => {
    if (stopped) return;

    if (document.visibilityState === 'visible') {
      schedule();
    } else {
      // Discard the partial interval rather than credit time the user was away.
      clear();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  if (document.visibilityState === 'visible') schedule();

  return {
    stop(): void {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
