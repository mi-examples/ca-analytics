import { ENTITY_NAME, MI_PAGE_PATH_RE, WIDTHS } from './constants';
import type { Options, ResolvedConfig } from './types';

/** Unsubstituted PP variable, e.g. '[Custom App Analytics Enabled]'. Treated as unset. */
const UNSUBSTITUTED_RE = /^\[[A-Za-z0-9][A-Za-z0-9 _-]*\]$/;

function portalVariables(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};

  const block = (window as unknown as Record<string, unknown>).PP_VARIABLES;

  return block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>) : {};
}

/** PP variables arrive as strings, so '0' and 'false' must not read truthy. */
function readFlag(key: string): boolean | undefined {
  const raw = portalVariables()[key];

  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return undefined;

  const value = raw.trim().toLowerCase();

  if (value === '' || UNSUBSTITUTED_RE.test(raw.trim())) return undefined;

  return value !== '0' && value !== 'false' && value !== 'n' && value !== 'no';
}

function matchPage(): RegExpExecArray | null {
  if (typeof window === 'undefined' || !window.location) return null;

  return MI_PAGE_PATH_RE.exec(window.location.pathname);
}

/** Route below the portal page. '/' at the page root. */
export function currentPagePath(): string {
  const match = matchPage();

  if (!match) return '/';

  const rest = match[3];

  return (rest && rest !== '' && rest !== '/' ? rest : '/').slice(0, WIDTHS.page_path);
}

/** Runtime config, or null when ca-analytics must stay silent: disabled, or not on a portal page. */
export function resolveConfig(options: Options = {}): ResolvedConfig | null {
  const enabled = options.enabled ?? readFlag('CUSTOM_APP_ANALYTICS_ENABLED') ?? true;

  if (!enabled) return null;

  const app = (options.app ?? matchPage()?.[2] ?? '').slice(0, WIDTHS.app);

  if (!app) return null;

  return { app, endpoint: `/data/page/${encodeURIComponent(app)}/${ENTITY_NAME}` };
}
