/** Entity name bound on every tracked app's portal page. Not configurable. */
export const ENTITY_NAME = 'analytics_events';

/** From package.json at build time. */
export const VERSION = __VERSION__;

/** MI serves portal pages at /p/<name>, /pl/<name> or /pt/<name>. */
export const MI_PAGE_PATH_RE = /^\/(p[tl]?)\/([^/]+)(.*)$/;

/** Per-field payload caps that keep a batch within sendBeacon's 64 KiB quota, not schema limits. */
export const WIDTHS = {
  app: 100,
  event: 100,
  page_path: 400,
  version: 20,
  meta: 2000,
} as const;

/** Emitted by ca-analytics. track() rejects them so app code cannot forge them. */
export const RESERVED_EVENTS = ['page_view', 'heartbeat', 'component_render', 'element_click'] as const;

/** Custom event names must match this or track() warns once. Silent drift creates permanent duplicate series. */
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,99}$/;

/** Per-key meta caps, applied before serializeMeta so one long value can't push another key out. */
export const LIMITS = { referrer: 300, query: 300 } as const;
