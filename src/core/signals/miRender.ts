import { toId } from '../event';

export const RENDER_CAP = 50;

export interface RenderPayload {
  elementId: number;
  meta: Record<string, unknown>;
}

/** Listens on `document` only: `MiNamespace.render()` dispatches a bubbling CustomEvent, so load order doesn't matter. */
export function startMiRender(emit: (payload: RenderPayload) => void): { stop(): void } {
  let stopped = false;
  const counts = new Map<string, number>();

  const onRender = (event: Event) => {
    if (stopped) return;

    try {
      const detail = (event as CustomEvent).detail as { component?: unknown; props?: unknown } | undefined;

      if (!detail || typeof detail !== 'object') return;

      const component = typeof detail.component === 'string' ? detail.component : '';

      if (!component) return;

      const props = (detail.props && typeof detail.props === 'object' ? detail.props : {}) as Record<string, unknown>;
      // Apps send either {element, segment} or {element_id, segment_value_id}.
      const elementId = toId(props.element ?? props.element_id ?? 0);
      const segmentId = toId(props.segment ?? props.segment_value_id ?? 0);

      const key = `${component}|${elementId}|${segmentId}`;
      const seq = (counts.get(key) ?? 0) + 1;

      // Some apps re-render on every filter change; uncapped, one page burns the throttle budget.
      if (seq > RENDER_CAP) return;

      counts.set(key, seq);

      const meta: Record<string, unknown> = {
        component,
        element_id: elementId,
        segment_id: segmentId,
      };

      if (seq === RENDER_CAP) meta.capped = 1;

      emit({ elementId, meta });
    } catch {
      // Never throw into the host render path.
    }
  };

  document.addEventListener('mi-render', onRender);

  return {
    stop(): void {
      stopped = true;
      document.removeEventListener('mi-render', onRender);
      counts.clear();
    },
  };
}
