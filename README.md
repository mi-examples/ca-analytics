# @metricinsights/ca-analytics

Zero-dependency usage analytics for Metric Insights Custom Apps. Runs in the browser, batches
page views, engagement heartbeats, component renders and custom events, and writes them into an
App Dataset entity named `analytics_events` on the tracked app's own portal page.

Rows written here are read back by the Custom Apps Analytics Dashboard, which turns them into
adoption, per-element usage, and audience reporting. This package only writes.

## Install

```
npm i @metricinsights/ca-analytics
```

`react` is an optional peer dependency (`>=18.0.0`), needed only for the `useAnalytics()` hook.

## Setup

1. **Create the dataset.** In MI, a new dataset with source type "CSV/Excel" (manual upload).
   Save it **without uploading a file** — and never upload one. See
   [One-way doors](#one-way-doors).
2. **Create the entity.** On the tracked app's **own** portal page, an entity named
   `analytics_events` bound to that dataset: type Internal, App Dataset ticked, access type
   `private`.

   It must live on the app's own page. MI checks portal-page permission before any entity logic
   runs, so a central page holding every app's entity would 403 for the very users the app is
   trying to track.
3. **Call `init()`.** Nothing else. The table and its columns are created from the first batch
   `ca-analytics` POSTs, and `createRow()` always emits correct types, so there is no
   provisioning step.

## Usage

```ts
import { init, useAnalytics } from '@metricinsights/ca-analytics';

// app entry, once
init();

// anywhere in the app
const { track } = useAnalytics();
track('tile_clicked', { tile: 'revenue' });
```

`useAnalytics()` is a thin wrapper over the module singleton — no provider, no context, callable
from any component.

## API

### Lifecycle

| Export | Signature | Notes |
| --- | --- | --- |
| `init` | `(options?: Options) => void` | Idempotent; a second call while active is a no-op. Never throws. |
| `shutdown` | `() => void` | Flushes the buffer, stops every signal, detaches listeners, unpatches `history`. |
| `isActive` | `() => boolean` | Whether `init()` has run and `shutdown()` hasn't. |

`shutdown()` clears in-memory session state only. The session id stays in `localStorage`, so a
later `init()` inside the 30-minute idle window resumes the *same* `session_id`.

### Tracking

| Export | Signature | Notes |
| --- | --- | --- |
| `track` | `(event: string, props?: Record<string, unknown>) => void` | Empty and [reserved](#events) names are ignored. |
| `trackElement` | `(props: { element_id: number; segment_id?: number; [key: string]: unknown }) => void` | Emits `element_click`. |
| `trackPageView` | `(path?: string) => void` | For routers the `history` patch cannot observe. Skips dedupe — always emits. |
| `useAnalytics` | `() => { track, trackElement, trackPageView }` | React hook; no provider needed. |

### Constants

| Export | Value | Notes |
| --- | --- | --- |
| `ENTITY_NAME` | `'analytics_events'` | The entity name every app binds to. Use it to build read endpoints (`/data/page/<app>/<ENTITY_NAME>`) instead of hardcoding the string. |
| `VERSION` | `string` | This package's version, injected from `package.json` at build time. Already stamped on every row as `version`, so readers can segment by build; read it directly for debug output. |

### Options

Every option is optional. Each falls back to a portal-page variable, then to a default.

| Option | Variable | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | `CUSTOM_APP_ANALYTICS_ENABLED` | `true` | `false` disables all tracking. |

Portal-page variables are read from `window.PP_VARIABLES` and always arrive as **strings**.
`'0'`, `'false'`, `'n'`, `'no'` (case-insensitive, trimmed) mean disabled; any other non-empty
string means enabled. Unset, empty, or left unsubstituted by MI (a literal `[Custom App
Analytics Enabled]`) counts as *not set* and falls through to the option or default.

## Events

| Event | Fires when | `meta` |
| --- | --- | --- |
| `page_view` | Once on `init()`, then on every `pushState` / `replaceState` / `popstate`, or on demand via `trackPageView()`. | `referrer`, `query` — always both, always strings |
| `heartbeat` | Tab visible: every 60s for 5 beats, then every 300s. | `{}` |
| `component_render` | The `mi-render` `CustomEvent` MI dispatches on `document`. | `component`, `element_id`, `segment_id`, plus each prop as `prop.<path>` |
| `element_click` | `trackElement()`. | `element_id`, `segment_id`, plus your own keys |
| *(custom)* | `track(name, props)`. | your `props` verbatim |

The four built-in names are reserved: `track('page_view', …)` from app code is ignored, so
nothing can forge a row `ca-analytics` produces.

Custom event names should match `/^[a-z][a-z0-9_]{0,99}$/` (lowercase snake_case, ≤100 chars). A
name that does not match is still tracked verbatim but logs one console warning, because the
dataset is append-only with no rename — `'Tile Click'`, `'tile_click '` and `'tileClick'` would
become three permanent, unmergeable series. Reserved-name matching is case-insensitive.

Two meta keys are reserved: `_truncated` is stamped only when meta actually exceeds 2000
characters, and the dashboard hides both `_truncated` and `capped` from its property view, so do
not use either as your own prop name.

**`page_view`** dedupes on path + search, so a router calling `replaceState` for scroll or filter
sync does not emit. `meta.referrer` follows GA4 semantics: the first view of the document uses
`document.referrer` normalized to origin + pathname; every later view uses the `page_path` of the
previous view. `meta.query` is `location.search` without the leading `?`. Both are capped at 300
characters; either can be `''`.

**`component_render`** reads `detail.component` plus `detail.props`. `MiNamespace.render()` is a
pure event emitter, so `document` sees every shared component render — no patching.

Identity comes only from `element`/`element_id` and `segment`/`segment_id`/`segment_value_id` —
the spellings MI's own components use. No other key feeds `element_id`, which joins to
`/api/element_info`, where a foreign numeric id would join wrong.

Every other prop flattens to `prop.<dotted.path>` — flat, because the dashboard summarizes per
key and a nested object collapses to one opaque string. Scalars verbatim, strings capped at 40,
arrays as `arr:<length>`, 4 levels deep, 20 keys.

Props are stored verbatim and readable by anyone with dashboard access. Keep record-specific text
out of props you render with.

Capped at 50 emits per distinct component + element + segment + props; the capping emit carries
`capped: 1`. Past 200 buckets a page load, further renders share one.

**`trackElement`** needs `element_id` to be finite and non-zero — anything else drops the event
(one `console.warn` per runtime). `segment_id` is optional and defaults to `0` when omitted, with
no warning; a supplied non-finite value also records `0` but logs one `console.warn` per runtime.
Extra props pass through to `meta` untouched, and
`element_id`/`segment_id` are written *after* the spread, so a caller cannot overwrite them.

```ts
trackElement({ element_id: 4417, segment_id: 12, label: 'Q3 Revenue' });
```

## The row

Every event becomes the same nine keys. `owner_user_id` is a tenth stored column the server
stamps itself — the client never sends it.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Client UUID. Reused across a retry so readers dedupe with `COUNT(DISTINCT id)`. |
| `ts` | datetime | `YYYY-MM-DD HH:MM:SS`, UTC. **Never ISO** — see [One-way doors](#one-way-doors). |
| `app` | text | Portal page internal name, read from `location.pathname` against `/^\/(p[tl]?)\/([^/]+)(.*)$/`. Capped at 100. |
| `event` | text | Capped at 100. |
| `session_id` | text | New session after 30 minutes idle. Survives reloads via `localStorage`. |
| `page_path` | text | Route below the portal page, `/` at the root. Capped at 400. |
| `element_id` | int | `0` when not applicable. Integers only. |
| `version` | text | This package's version, capped at 20. |
| `meta` | text | JSON string, capped at 2000. |

`pp-dev` serves that same path locally. **Off that path shape, `init()` stays silent** rather
than writing rows with a blank `app` that nothing could attribute.

Text columns are wide (10500) and the caps above are client-side payload budget, keeping a batch
inside `sendBeacon`'s 64 KiB quota — they are not schema limits.

`meta` over 2000 characters drops whole keys rather than slicing, so the stored value always
parses, and stamps `_truncated: 1`.

## Delivery

Rows buffer and flush on whichever comes first: 15 seconds, 50 rows, or 30 KB encoded. On
`pagehide`, and on `visibilitychange` to hidden (which is what actually fires on iOS), the buffer
goes out via `sendBeacon`, falling back to `fetch(…, { keepalive: true })`.

A failed batch retries once after 2 seconds — network errors, 429 and 5xx are retryable; a `200`
carrying a non-zero `resultCode` is a rejected insert and is not. A failed batch is dropped, not
re-buffered, since re-sending a batch whose response was merely lost is what creates duplicates.

Three consecutive failed flushes trip a kill-switch that tears everything down — timers,
listeners, history patch — because every row after that point would be discarded anyway.

Nothing here throws into the host app. Every public entry point and every host callback is
wrapped.

## One-way doors

> Each of these is unrecoverable in place.
>
> - **Never upload a CSV/Excel file to the `analytics_events` dataset.** A Collect run against a
>   manual dataset that has never had a file uploaded fails early and leaves the table alone. A
>   dataset that already has columns instead drops its table on a zero-row fetch.
> - **Never add a `UNIQUE` index, least of all on `id`.** The server does not deduplicate. Under a
>   unique constraint a duplicate raises an integrity violation that kills the *entire* batch,
>   good rows included. Retries deliberately reuse the same `id`, and readers are expected to
>   dedupe with `COUNT(DISTINCT id)`.
> - **Never send `ts` as ISO 8601.** MI infers column types from the first payload. A `T`/`Z`
>   timestamp is read as text and the column is text forever; the space-separated form is what
>   produces a real `datetime`.
> - **Never put a non-integer in `element_id`.** Inferred types widen and never narrow
>   (`int → float → text`). One float or string converts the column permanently.
> - **Never send `owner_user_id`.** The server stamps it and creates the column itself.

## License

MIT © 2026 Metric Insights
