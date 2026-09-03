import { encodeSupabaseFilter, supabaseRestFetch } from "./supabase-rest";
import type { FlowusConfig } from "@/lib/flowus-types";

export interface FlowusConfigRow {
  account_id: string;
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
  created_at?: string;
  updated_at?: string;
}

function rowToConfig(row: FlowusConfigRow): FlowusConfig {
  return {
    connected: row.connected ?? false,
    parent_page_id: row.parent_page_id || undefined,
    parent_page_title: row.parent_page_title || undefined,
    inbox_database_id: row.inbox_database_id || undefined,
    inbox_database_title: row.inbox_database_title || undefined,
    todo_database_id: row.todo_database_id || undefined,
    todo_database_title: row.todo_database_title || undefined,
    todo_status_field: row.todo_status_field || undefined,
    todo_done_value: row.todo_done_value || undefined,
    character_scope: row.character_scope || "account",
    allowed_character_ids: row.allowed_character_ids || [],
  };
}

export async function getFlowusConfig(accountId: string): Promise<FlowusConfig | null> {
  const result = await supabaseRestFetch<FlowusConfigRow[]>(
    `app_flowus_configs?account_id=eq.${encodeSupabaseFilter(accountId)}&select=*&limit=1`,
    { method: "GET" },
  );
  if (!result.ok) {
    console.error("[flowus-config-db] get config failed:", result.error);
    return null;
  }
  const row = result.data[0];
  return row ? rowToConfig(row) : null;
}

export async function upsertFlowusConfig(
  accountId: string,
  config: Partial<FlowusConfig>,
): Promise<FlowusConfig | null> {
  const row: Partial<FlowusConfigRow> = {
    account_id: accountId,
    connected: config.connected ?? true,
    parent_page_id: config.parent_page_id,
    parent_page_title: config.parent_page_title,
    inbox_database_id: config.inbox_database_id,
    inbox_database_title: config.inbox_database_title,
    todo_database_id: config.todo_database_id,
    todo_database_title: config.todo_database_title,
    todo_status_field: config.todo_status_field,
    todo_done_value: config.todo_done_value,
    character_scope: config.character_scope,
    allowed_character_ids: config.allowed_character_ids,
    updated_at: new Date().toISOString(),
  };

  const result = await supabaseRestFetch<FlowusConfigRow[]>(
    "app_flowus_configs",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );
  if (!result.ok) {
    console.error("[flowus-config-db] upsert config failed:", result.error);
    return null;
  }
  return result.data[0] ? rowToConfig(result.data[0]) : null;
}

export async function deleteFlowusConfig(accountId: string): Promise<boolean> {
  const result = await supabaseRestFetch<unknown>(
    `app_flowus_configs?account_id=eq.${encodeSupabaseFilter(accountId)}`,
    { method: "DELETE" },
  );
  if (!result.ok) {
    console.error("[flowus-config-db] delete config failed:", result.error);
    return false;
  }
  return true;
}
