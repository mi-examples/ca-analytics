# Changelog

## [0.3.0](https://github.com/mi-examples/ca-analytics/compare/v0.2.0...v0.3.0) (2026-09-28)

### ⚠ Breaking changes

- The package now declares `engines.node` `>=22`, so installs on older Node.js versions may warn or fail (for example with `engine-strict`); upgrade your toolchain to Node.js 22 or later.

### Features

- Hash-routed apps (such as React Router's `HashRouter`) are now tracked without extra setup: a `#/` fragment becomes the `page_path`, its query is appended to `meta.query`, and `hashchange` navigations emit a `page_view`. Plain in-page anchors such as `#section` still never change `page_path` or emit a `page_view`.

### Bug fixes

- `track()` and `trackElement()` now accept any props object, including interface-typed props, `Date` values and `unknown` values, without TypeScript errors; runtime serialization is unchanged.
- An `element_id` outside the 32-bit integer range is now recorded as `0` (and `trackElement()` drops the event), so it no longer overflows or permanently widens the `element_id` column.
- A burst of events during an in-flight request no longer grows the buffer past its limits, and the unload beacon is now sent in chunks of at most 30 KB, so rows are no longer all lost when the page closes.
- A brief outage during a burst no longer trips the kill-switch within seconds, because after a failed request the next attempt waits for the regular flush timer.
- Calling `init()` again after `shutdown()` (HMR, user switch, StrictMode) can no longer be shut down by a stale flush from the previous runtime.
- A failing `fetch` with `keepalive` on page unload no longer surfaces as an unhandled promise rejection in the host app.
