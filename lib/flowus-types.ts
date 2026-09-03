export interface FlowusParent {
  type: "workspace" | "page_id" | "database_id" | "block_id";
  workspace?: boolean;
  page_id?: string;
  database_id?: string;
  block_id?: string;
}

export interface FlowusRichText {
  type: "text" | "mention" | "equation";
  text?: { content: string; link?: { url: string } | null };
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

export interface FlowusIcon {
  type: "emoji" | "external" | "file";
  emoji?: string;
  external?: { url: string };
  file?: { url: string; expiry_time?: string };
}

export interface FlowusSelectOption {
  id?: string;
  name: string;
  color?: string;
}

export interface FlowusDateValue {
  start: string;
  end: string | null;
  time_zone: string | null;
}

export type FlowusPropertySchema =
  | { id?: string; name?: string; type: "title"; title?: Record<string, never> }
  | { id?: string; name?: string; type: "rich_text"; rich_text?: Record<string, never> }
  | { id?: string; name?: string; type: "number"; number?: { format?: string } }
  | { id?: string; name?: string; type: "select"; select?: { options?: FlowusSelectOption[] } }
  | { id?: string; name?: string; type: "multi_select"; multi_select?: { options?: FlowusSelectOption[] } }
  | { id?: string; name?: string; type: "date"; date?: Record<string, never> }
  | { id?: string; name?: string; type: "checkbox"; checkbox?: Record<string, never> }
  | { id?: string; name?: string; type: "url"; url?: Record<string, never> }
  | { id?: string; name?: string; type: "email"; email?: Record<string, never> }
  | { id?: string; name?: string; type: "phone_number"; phone_number?: Record<string, never> }
  | { id?: string; name?: string; type: "people"; people?: Record<string, never> }
  | { id?: string; name?: string; type: "files"; files?: Record<string, never> }
  | { id?: string; name?: string; type: "formula"; formula?: { expression: string } }
  | { id?: string; name?: string; type: "relation"; relation?: { database_id?: string | null; type?: string; synced_property_id?: string } }
  | { id?: string; name?: string; type: "rollup"; rollup?: { relation_property_id?: string | null; rollup_property_id?: string | null; function?: string } }
  | { id?: string; name?: string; type: "created_time"; created_time?: Record<string, never> }
  | { id?: string; name?: string; type: "created_by"; created_by?: Record<string, never> }
  | { id?: string; name?: string; type: "last_edited_time"; last_edited_time?: Record<string, never> }
  | { id?: string; name?: string; type: "last_edited_by"; last_edited_by?: Record<string, never> };

export type FlowusPropertyValue =
  | { id?: string; type: "title"; title: FlowusRichText[] }
  | { id?: string; type: "rich_text"; rich_text: FlowusRichText[] }
  | { id?: string; type: "number"; number: number | null }
  | { id?: string; type: "select"; select: FlowusSelectOption | null }
  | { id?: string; type: "multi_select"; multi_select: FlowusSelectOption[] }
  | { id?: string; type: "date"; date: FlowusDateValue | null }
  | { id?: string; type: "checkbox"; checkbox: boolean }
  | { id?: string; type: "url"; url: string | null }
  | { id?: string; type: "email"; email: string | null }
  | { id?: string; type: "phone_number"; phone_number: string | null }
  | { id?: string; type: "people"; people: { object: "user"; id: string }[] }
  | { id?: string; type: "files"; files: { name: string; type: "file" | "external"; file?: { url: string }; external?: { url: string } }[] }
  | { id?: string; type: "formula"; formula: { type: string; string?: string | null; number?: number | null; boolean?: boolean | null } }
  | { id?: string; type: "rollup"; rollup: { type: string; number?: number | null } }
  | { id?: string; type: "created_time"; created_time: string }
  | { id?: string; type: "created_by"; created_by: { object: "user"; id: string } }
  | { id?: string; type: "last_edited_time"; last_edited_time: string }
  | { id?: string; type: "last_edited_by"; last_edited_by: { object: "user"; id: string } };

export interface FlowusPage {
  object: "page";
  id: string;
  page_type?: string;
  parent?: FlowusParent;
  properties: Record<string, FlowusPropertyValue>;
  icon?: FlowusIcon | null;
  cover?: FlowusIcon | null;
  in_trash: boolean;
  url?: string;
}

export interface FlowusDatabase {
  object: "database";
  id: string;
  title: FlowusRichText[];
  description?: FlowusRichText[];
  parent?: FlowusParent;
  properties: Record<string, FlowusPropertySchema>;
  icon?: FlowusIcon | null;
  cover?: FlowusIcon | null;
  in_trash: boolean;
  is_inline?: boolean;
  url?: string;
}

export interface FlowusList<T> {
  object: "list";
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface FlowusSearchResult {
  object: "search_result";
  page_id: string;
  page_title?: string;
  score?: number;
  snippet?: string;
  url?: string;
}

export interface FlowusFilter {
  property?: string;
  timestamp?: string;
  and?: FlowusFilter[];
  or?: FlowusFilter[];
  title?: Record<string, unknown>;
  rich_text?: Record<string, unknown>;
  number?: Record<string, unknown>;
  select?: Record<string, unknown>;
  multi_select?: Record<string, unknown>;
  date?: Record<string, unknown>;
  checkbox?: Record<string, unknown>;
}

export interface FlowusSort {
  property?: string;
  timestamp?: string;
  direction: "ascending" | "descending";
}

export interface FlowusUser {
  object: "user" | "bot_user";
  id: string;
  name?: string;
  avatar_url?: string | null;
  workspace_id?: string;
  workspace_name?: string;
}

export interface FlowusConfig {
  connected: boolean;
  parent_page_id?: string;
  parent_page_title?: string;
  inbox_database_id?: string;
  inbox_database_title?: string;
  todo_database_id?: string;
  todo_database_title?: string;
  todo_status_field?: string;
  todo_done_value?: string;
  character_scope?: "account" | "character";
  allowed_character_ids?: string[];
}

export interface FlowusOperation {
  id?: string;
  account_id: string;
  character_id?: string | null;
  action: "create_todo" | "update_todo" | "query_todo" | "create_database_row" | "query_database" | "save_chat_favorite" | "search" | "create_inbox" | "create_todo_db";
  status: "pending" | "running" | "success" | "partial" | "failed";
  upstream_request_id?: string;
  upstream_error_code?: string;
  upstream_error_message?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}
