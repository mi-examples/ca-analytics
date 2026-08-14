import { toId } from '../event';

export const RENDER_CAP = 50;
/** Distinct cap buckets per page load. Past this every render of a component shares one bucket, so per-render props can't leak the map. */
const MAX_KEYS = 200;
/** `visibility.preview.control_buttons.lineage` is 4 levels, the deepest shape MI documents. */
const PROP_DEPTH = 4;
/** A `viewer` render is 38 leaves / 1672 chars, so this must not bind before serializeMeta's own cap does. */
const PROP_KEYS = 40;
const PROP_STRING = 40;

/** Already read into element_id/segment_id above; re-emitting them as props is noise. */
const IDENTITY_KEYS = new Set(['element', 'element_id', 'segment', 'segment_id', 'segment_value_id']);

const SKIP = Symbol('skip');

export interface RenderPayload {
  elementId: number;
  meta: Record<string, unknown>;
}

function leafValue(value: unknown): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : SKIP;
    case 'string':
      return value.slice(0, PROP_STRING);
    default:
      return SKIP;
  }
}

/** Dotted paths, flat output: the dashboard stringifies a nested object into one opaque value, so its per-key distribution would be noise. Returns true when a cap dropped something. */
function flattenProps(source: Record<string, unknown>, out: Record<string, unknown>, prefix: string, depth: number): boolean {
  let dropped = false;

  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(out).length >= PROP_KEYS) return true;
    if (depth === 0 && IDENTITY_KEYS.has(key)) continue;

    const path = prefix === '' ? key : `${prefix}.${key}`;

    // Summarized, not expanded — index-keyed paths would make every array length its own set of keys.
    if (Array.isArray(value)) {
      out[`prop.${path}`] = `arr:${value.length}`;
      continue;
    }

    if (value !== null && typeof value === 'object') {
      if (depth + 1 < PROP_DEPTH) dropped = flattenProps(value as Record<string, unknown>, out, path, depth + 1) || dropped;
      else dropped = true;

      continue;
    }

    const leaf = leafValue(value);

    if (leaf !== SKIP) out[`prop.${path}`] = leaf;
  }

  return dropped;
}

/** FNV-1a. Keeps the bucket key short no matter how large the props are. */
function hash(text: string): string {
  let h = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(36);
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
      // Three spellings in the wild: preview sends {element, segment}, viewer {element_id, segment_id}, access_denied_popup {element_id, segment_value_id}.
      const elementId = toId(props.element ?? props.element_id ?? 0);
      const segmentId = toId(props.segment ?? props.segment_id ?? props.segment_value_id ?? 0);

      const flat: Record<string, unknown> = {};
      const propsDropped = flattenProps(props, flat, '', 0);

      // Props are in the key: a component with no element (a popup) is otherwise one bucket for every variant it renders.
      const bucket = `${component}|${elementId}|${segmentId}|${hash(JSON.stringify(flat))}`;
      const key = counts.has(bucket) || counts.size < MAX_KEYS ? bucket : `${component}|*`;
      const seq = (counts.get(key) ?? 0) + 1;

      // Some apps re-render on every filter change; uncapped, one page burns the throttle budget.
      if (seq > RENDER_CAP) return;

      counts.set(key, seq);

      // Reserved keys first: serializeMeta drops trailing keys at the 2000-char cap, so props go before identity does.
      const meta: Record<string, unknown> = {
        component,
        element_id: elementId,
        segment_id: segmentId,
        ...flat,
      };

      if (propsDropped) meta.props_dropped = 1;
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
