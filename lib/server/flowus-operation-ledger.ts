import { encodeSupabaseFilter, supabaseRestFetch } from "./supabase-rest";
import type { FlowusOperation } from "@/lib/flowus-types";

interface FlowusOperationRow {
  id: string;
  account_id: string;
  character_id: string | null;
  action: FlowusOperation["action"];
  status: FlowusOperation["status"];
  upstream_request_id: string | null;
  upstream_error_code: string | null;
  upstream_error_message: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToOperation(row: FlowusOperationRow): FlowusOperation {
  return {
    id: row.id,
    account_id: row.account_id,
    character_id: row.character_id,
    action: row.action,
    status: row.status,
    upstream_request_id: row.upstream_request_id ?? undefined,
    upstream_error_code: row.upstream_error_code ?? undefined,
    upstream_error_message: row.upstream_error_message ?? undefined,
    payload: row.payload ?? {},
    result: row.result,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createFlowusOperation(
  accountId: string,
  op: Omit<FlowusOperation, "id" | "account_id" | "created_at" | "updated_at">,
): Promise<FlowusOperation | null> {
  const result = await supabaseRestFetch<FlowusOperationRow[]>(
    "app_flowus_operations",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        account_id: accountId,
        character_id: op.character_id ?? null,
        action: op.action,
        status: op.status,
        upstream_request_id: op.upstream_request_id ?? null,
        upstream_error_code: op.upstream_error_code ?? null,
        upstream_error_message: op.upstream_error_message ?? null,
        payload: op.payload,
        result: op.result ?? null,
      }),
    },
  );
  if (!result.ok) {
    console.error("[flowus-operation-ledger] create failed:", result.error);
    return null;
  }
  return result.data[0] ? rowToOperation(result.data[0]) : null;
}

export async function updateFlowusOperation(
  operationId: string,
  patch: Partial<Pick<FlowusOperation, "status" | "upstream_request_id" | "upstream_error_code" | "upstream_error_message" | "result">>,
): Promise<FlowusOperation | null> {
  const result = await supabaseRestFetch<FlowusOperationRow[]>(
    `app_flowus_operations?id=eq.${encodeSupabaseFilter(operationId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: patch.status,
        upstream_request_id: patch.upstream_request_id ?? undefined,
        upstream_error_code: patch.upstream_error_code ?? undefined,
        upstream_error_message: patch.upstream_error_message ?? undefined,
        result: patch.result,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!result.ok) {
    console.error("[flowus-operation-ledger] update failed:", result.error);
    return null;
  }
  return result.data[0] ? rowToOperation(result.data[0]) : null;
}

export async function listFlowusOperations(
  accountId: string,
  options: { limit?: number; action?: FlowusOperation["action"] } = {},
): Promise<FlowusOperation[]> {
  let url = `app_flowus_operations?account_id=eq.${encodeSupabaseFilter(accountId)}&select=*&order=created_at.desc`;
  if (options.action) {
    url += `&action=eq.${encodeSupabaseFilter(options.action)}`;
  }
  const limit = Number.isFinite(options.limit as number) ? Math.max(1, Math.min(100, options.limit ?? 50)) : 50;
  url += `&limit=${limit}`;

  const result = await supabaseRestFetch<FlowusOperationRow[]>(url, { method: "GET" });
  if (!result.ok) {
    console.error("[flowus-operation-ledger] list failed:", result.error);
    return [];
  }
  return (result.data ?? []).map(rowToOperation);
}
