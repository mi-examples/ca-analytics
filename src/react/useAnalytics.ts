import { track, trackElement, trackPageView } from '../core/analytics';

/** Thin wrapper over the module singleton. No provider, no context — ca-analytics renders nothing. */
const api = { track, trackElement, trackPageView } as const;

export function useAnalytics(): typeof api {
  return api;
}
