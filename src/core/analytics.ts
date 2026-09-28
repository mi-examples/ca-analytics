import { EVENT_NAME_RE, LIMITS, RESERVED_EVENTS } from './constants';
import { currentPagePath, currentQuery, resolveConfig } from './config';
import { createRow, toId } from './event';
import { createQueue, type Queue } from './queue';
import { getSessionId, resetSession } from './session';
import { startHeartbeat } from './signals/heartbeat';
import { startMiRender } from './signals/miRender';
import { startPageView, type PageViewSignal } from './signals/pageview';
import type { Options } from './types';

type Emit = (
  event: string,
  extra?: { pagePath?: string; elementId?: number; meta?: Record<string, unknown> },
) => void;

interface Runtime {
  queue: Queue;
  emit: Emit;
  detachUnload: () => void;
  pageView: PageViewSignal;
  stopHeartbeat: () => void;
  stopMiRender: () => void;
}

let runtime: Runtime | null = null;
const warnedOnce = new Set<string>();

/** Nothing in ca-analytics may throw into the host app. */
function guard(fn: () => void): void {
  try {
    fn();
  } catch {
    // swallowed
  }
}

/** Warns about caller misuse only the first time `key` is seen. */
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;

  warnedOnce.add(key);
  console.warn(`[ca-analytics] ${message}`);
}

function pageViewMeta(referrer: string): Record<string, unknown> {
  const query = currentQuery();

  return { referrer: referrer.slice(0, LIMITS.referrer), query: query.slice(0, LIMITS.query) };
}

/** Stops whatever of init()'s parts already started, used both for teardown and a failed startup. */
function stopStarted(
  parts: {
    queue: Queue;
    detachUnload: () => void;
    pageView?: PageViewSignal;
    stopHeartbeat?: () => void;
    stopMiRender?: () => void;
  },
  flushFirst: boolean,
): void {
  if (flushFirst) guard(() => parts.queue.flushOnUnload());

  guard(() => parts.pageView?.stop());
  guard(() => parts.stopHeartbeat?.());
  guard(() => parts.stopMiRender?.());
  guard(() => parts.detachUnload());
  guard(() => parts.queue.stop());
}

/** Unwinds everything `init()` started; `flushFirst` also drains the buffer via the unload path. `runtime` is cleared first so a re-entrant call is a no-op. */
function teardown(flushFirst: boolean): void {
  const current = runtime;

  if (!current) return;

  runtime = null;
  warnedOnce.clear();

  stopStarted(current, flushFirst);
  resetSession();
}

/** Idempotent. A second call while active is ignored rather than doubling listeners. */
export function init(options: Options = {}): void {
  guard(() => {
    if (runtime) return;

    const config = resolveConfig(options);

    if (!config) return;

    // A tripped kill-switch tears down ca-analytics entirely, not just the queue — but only while this
    // queue's runtime is still the live one, so a stale queue can't kill a later init().
    const queue: Queue = createQueue(config.endpoint, () => {
      if (runtime?.queue === queue) shutdown();
    });

    const emit: Emit = (event, extra = {}) => {
      queue.push(
        createRow({
          app: config.app,
          event,
          sessionId: getSessionId(),
          pagePath: extra.pagePath ?? currentPagePath(),
          elementId: extra.elementId,
          meta: extra.meta,
        }),
      );
    };

    const onUnload = () => guard(() => queue.flushOnUnload());
    // pagehide alone is unreliable on iOS; visibilitychange is what fires there.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onUnload();
    };
    const detachUnload = () => {
      window.removeEventListener('pagehide', onUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    let pageView: PageViewSignal | undefined;
    let stopHeartbeat: (() => void) | undefined;
    let stopMiRender: (() => void) | undefined;

    // A later step throwing must unwind what already started, or its timers/listeners leak.
    try {
      window.addEventListener('pagehide', onUnload);
      document.addEventListener('visibilitychange', onVisibility);

      stopHeartbeat = startHeartbeat(() => emit('heartbeat')).stop;
      stopMiRender = startMiRender((payload) =>
        emit('component_render', { elementId: payload.elementId, meta: payload.meta }),
      ).stop;
      pageView = startPageView(
        (path, referrer) => emit('page_view', { pagePath: path, meta: pageViewMeta(referrer) }),
        currentPagePath,
      );
    } catch (error) {
      stopStarted({ queue, detachUnload, pageView, stopHeartbeat, stopMiRender }, false);
      throw error;
    }

    runtime = { queue, emit, detachUnload, pageView, stopHeartbeat, stopMiRender };
  });
}

/** `props` is any object, interface-typed included; it is serialized like JSON.stringify (a Date becomes its ISO string). */
export function track(event: string, props?: object): void {
  guard(() => {
    if (!runtime) return;
    if (!event) return;

    const normalized = event.toLowerCase();

    if ((RESERVED_EVENTS as readonly string[]).includes(normalized)) {
      warnOnce('reserved', `"${event}" is reserved and was not tracked (further occurrences are silent)`);

      return;
    }

    if (!EVENT_NAME_RE.test(event)) {
      warnOnce('name', `"${event}" is not snake_case ≤100 chars; tracked as-is (further occurrences are silent)`);
    }

    runtime.emit(event, { meta: props as Record<string, unknown> | undefined });
  });
}

/**
 * `element_id`/`segment_id` resolve identity via `/api/element_info`; everything else is free-form. Generic so
 * interface-typed props with extra keys are accepted — an index signature would reject them.
 */
export function trackElement<T extends { element_id: number; segment_id?: number }>(props: T): void {
  guard(() => {
    if (!runtime) return;

    const { element_id, segment_id, ...extra } = props ?? {};
    const id = toId(element_id);

    if (!id) {
      warnOnce('element', `trackElement() ignored a zero, non-finite or out-of-range element_id (${element_id})`);

      return;
    }

    const segmentRaw = Number(segment_id);
    const segmentFinite = Number.isFinite(segmentRaw);

    // Omitting segment_id is a supported call; only a supplied-but-bad value is worth a warning.
    if (segment_id !== undefined && !segmentFinite) {
      warnOnce('segment', `trackElement() got a non-finite segment_id (${segment_id}); recorded as 0`);
    }

    // Reserved keys last: a caller's own element_id/segment_id in extra must not win the spread.
    const meta: Record<string, unknown> = {
      ...extra,
      element_id: id,
      segment_id: segmentFinite ? Math.trunc(segmentRaw) : 0,
    };

    runtime.emit('element_click', { elementId: id, meta });
  });
}

/** For routers whose navigation the history patch cannot observe. */
export function trackPageView(path?: string): void {
  guard(() => runtime?.pageView.emitNow(path));
}

/** Flushes what is buffered before stopping — up to 15s of events would otherwise drop. */
export function shutdown(): void {
  guard(() => teardown(true));
}

export function isActive(): boolean {
  return runtime !== null;
}
