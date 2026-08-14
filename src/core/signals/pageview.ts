export interface PageViewSignal {
  stop(): void;
  emitNow(path?: string): void;
}

/** Absolute for an inbound hop, bare route after — a route in another app is not comparable here. */
const inboundReferrer = (): string => {
  try {
    const raw = document.referrer;

    if (!raw) return '';

    const url = new URL(raw);

    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
};

/** Emits once on start, then on every history navigation. The original history method always still runs. */
export function startPageView(
  emit: (path: string, referrer: string) => void,
  currentPath: () => string,
): PageViewSignal {
  let stopped = false;
  let lastPath: string | null = null;
  let lastLocation: string | null = null;

  // Dedupe key: path alone can't tell a `?tab=` change from a no-op replaceState.
  const locationKey = (path: string): string => {
    try {
      return `${path}${window.location.search}`;
    } catch {
      return path;
    }
  };

  // resolvePath is a thunk so a throwing host currentPath() is caught here too, not in the caller.
  // dedupe is off for emitNow(): an explicit trackPageView() must always send.
  const safeEmit = (resolvePath: () => string, dedupe: boolean) => {
    if (stopped) return;

    try {
      const path = resolvePath();
      const location = locationKey(path);

      // Routers replaceState for scroll and filter sync without moving. Not a view.
      if (dedupe && location === lastLocation) return;

      // GA4 semantics: referrer is the previous page_view's path, not document.referrer, except first.
      const referrer = lastPath === null ? inboundReferrer() : lastPath;

      lastPath = path;
      lastLocation = location;
      emit(path, referrer);
    } catch {
      // swallowed
    }
  };

  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;

  const patch = (original: typeof window.history.pushState) =>
    function patched(this: History, ...args: Parameters<typeof window.history.pushState>) {
      const result = original.apply(this, args);

      safeEmit(currentPath, true);

      return result;
    };

  const patchedPush = patch(originalPush);
  const patchedReplace = patch(originalReplace);

  window.history.pushState = patchedPush;
  window.history.replaceState = patchedReplace;

  const onPopState = () => safeEmit(currentPath, true);

  window.addEventListener('popstate', onPopState);

  safeEmit(currentPath, true);

  return {
    stop(): void {
      stopped = true;
      lastPath = null;
      lastLocation = null;

      // Restore only if this signal still owns the patch — another startPageView may have patched over it.
      if (window.history.pushState === patchedPush) {
        window.history.pushState = originalPush;
      }

      if (window.history.replaceState === patchedReplace) {
        window.history.replaceState = originalReplace;
      }

      window.removeEventListener('popstate', onPopState);
    },
    emitNow(path?: string): void {
      safeEmit(() => path ?? currentPath(), false);
    },
  };
}
