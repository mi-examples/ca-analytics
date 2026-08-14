export type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };

export interface Options {
  /** Portal page internal_name. Default: derived from URL. */
  app?: string;
  /** false disables all tracking. Overrides PP_VARIABLES. */
  enabled?: boolean;
}

/** Row exactly as POSTed. owner_user_id is stamped server-side, never sent. */
export interface EventRow {
  id: string;
  ts: string;
  app: string;
  event: string;
  session_id: string;
  page_path: string;
  element_id: number;
  version: string;
  meta: string;
}

export interface ResolvedConfig {
  app: string;
  endpoint: string;
}
