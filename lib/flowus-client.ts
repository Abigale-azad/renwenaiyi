import type { FlowusConfig, FlowusOperation } from "./flowus-types";

export type FlowusApiError = { code: string; message: string; requestId?: string };

export interface FlowusApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: FlowusApiError;
}

/**
 * 兼容两种错误返回格式：
 * - 新格式：error: { code, message, requestId? }（/api/flowus action 接口）
 * - 旧格式：error: "错误文字字符串"（/api/flowus/config 等 REST 接口）
 */
function normalizeError(raw: unknown): FlowusApiError {
  if (typeof raw === "string") return { code: "unknown", message: raw };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const message = typeof obj.message === "string" && obj.message
      ? obj.message
      : typeof obj.error === "string" && obj.error
        ? obj.error
        : "请求失败";
    return {
      code: typeof obj.code === "string" ? obj.code : "unknown",
      message,
      requestId: typeof obj.requestId === "string" ? obj.requestId : undefined,
    };
  }
  return { code: "unknown", message: "请求失败" };
}

async function post<T>(action: string, payload: Record<string, unknown> = {}): Promise<FlowusApiResponse<T>> {
  const response = await fetch("/api/flowus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return { ok: false, error: { code: "parse_error", message: "无法解析响应" } };
  }
  const obj = json as Record<string, unknown>;
  if (obj.ok) return { ok: true, data: obj.data as T };
  return { ok: false, error: normalizeError(obj.error) };
}

export async function getFlowusConfigClient(): Promise<FlowusApiResponse<{ connected: boolean; config: FlowusConfig | null }>> {
  return post("get_config");
}

export async function connectFlowus(token: string): Promise<FlowusApiResponse<{ connected: boolean; config: FlowusConfig | null }>> {
  const response = await fetch("/api/flowus/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return { ok: false, error: { code: "parse_error", message: "无法解析响应" } };
  }
  const obj = json as Record<string, unknown>;
  if (obj.ok) return { ok: true, data: obj.data as { connected: boolean; config: FlowusConfig | null } };
  return { ok: false, error: normalizeError(obj.error) };
}

export async function disconnectFlowus(): Promise<FlowusApiResponse<{ connected: boolean }>> {
  const response = await fetch("/api/flowus/config", { method: "DELETE" });
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return { ok: false, error: { code: "parse_error", message: "无法解析响应" } };
  }
  const obj = json as Record<string, unknown>;
  if (obj.ok) return { ok: true, data: obj.data as { connected: boolean } };
  return { ok: false, error: normalizeError(obj.error) };
}

export async function updateFlowusConfigClient(
  config: Partial<FlowusConfig>,
): Promise<FlowusApiResponse<{ config: FlowusConfig }>> {
  const response = await fetch("/api/flowus/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== "object") {
    return { ok: false, error: { code: "parse_error", message: "无法解析响应" } };
  }
  const obj = json as Record<string, unknown>;
  if (obj.ok) return { ok: true, data: obj.data as { config: FlowusConfig } };
  return { ok: false, error: normalizeError(obj.error) };
}

export async function searchFlowusDatabases(query: string): Promise<FlowusApiResponse<{ results: { id: string; title: string }[] }>> {
  return post("search_databases", { query });
}

export async function searchFlowusPages(query: string): Promise<FlowusApiResponse<{ results: { id: string; title: string }[] }>> {
  return post("search_pages", { query });
}

export async function getFlowusDatabase(databaseId: string): Promise<FlowusApiResponse<{ id: string; title: string; properties: { id: string; name: string; type: string; options?: { name: string; color?: string }[] }[] }>> {
  return post("get_database", { databaseId });
}

export async function createFlowusInboxDatabase(parentPageId?: string, title?: string) {
  return post<{ id: string; title: string }>("create_inbox_database", { parentPageId, title });
}

export async function createFlowusTodoDatabase(parentPageId?: string, title?: string) {
  return post<{ id: string; title: string }>("create_todo_database", { parentPageId, title });
}

export async function queryFlowusDatabase(
  databaseId: string,
  options: { filter?: Record<string, unknown>; sorts?: unknown[]; startCursor?: string; pageSize?: number } = {},
) {
  return post<{ results: unknown[]; nextCursor: string | null; hasMore: boolean }>("query_database", {
    databaseId,
    filter: options.filter,
    sorts: options.sorts,
    startCursor: options.startCursor,
    pageSize: options.pageSize,
  });
}

export async function createFlowusDatabaseRow(databaseId: string, title: string, properties?: Record<string, unknown>) {
  return post<{ id: string; title: string }>("create_database_row", { databaseId, title, properties });
}

export async function updateFlowusDatabaseRow(pageId: string, properties: Record<string, unknown>) {
  return post<{ id: string; title: string }>("update_database_row", { pageId, properties });
}

export async function archiveFlowusDatabaseRow(pageId: string) {
  return post<{ id: string; title: string }>("archive_database_row", { pageId });
}

export async function createFlowusTodo(title: string, options: { status?: string; note?: string; databaseId?: string; characterId?: string } = {}) {
  return post<{ id: string; title: string }>("create_todo", { title, ...options });
}

export async function queryFlowusTodo(options: { status?: string; databaseId?: string; characterId?: string } = {}) {
  return post<{ results: unknown[]; nextCursor: string | null; hasMore: boolean }>("query_todo", options);
}

export async function updateFlowusTodo(
  pageId: string,
  options: { completed?: boolean; status?: string; note?: string; characterId?: string },
) {
  return post<{ id: string; title: string }>("update_todo", { pageId, ...options });
}

export async function searchFlowus(query: string, options: { characterId?: string } = {}) {
  return post<{ results: unknown[]; nextCursor: string | null; hasMore: boolean }>("search", { query, ...options });
}

export async function semanticSearchFlowus(query: string, options: { characterId?: string } = {}) {
  return post<{ results: { pageId: string; title: string; snippet: string; score: number; url: string }[] }>("semantic_search", { query, ...options });
}

export async function saveChatFavorite(payload: {
  title?: string;
  content: string;
  tags?: string[];
  url?: string;
  databaseId?: string;
  characterId?: string;
}) {
  return post<{ id: string; title: string }>("save_chat_favorite", payload);
}

export async function listFlowusOperations(limit?: number) {
  return post<{ operations: FlowusOperation[] }>("list_operations", { limit });
}

/** 测试当前 FlowUs 连接是否正常，返回用户信息。 */
export async function testFlowusConnection(): Promise<FlowusApiResponse<{ id: string; name: string }>> {
  return post<{ id: string; name: string }>("get_me", {});
}
