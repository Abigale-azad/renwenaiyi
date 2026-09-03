import type { FlowusConfig, FlowusOperation } from "./flowus-types";

export interface FlowusApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; requestId?: string };
}

async function post<T>(action: string, payload: Record<string, unknown> = {}): Promise<FlowusApiResponse<T>> {
  const response = await fetch("/api/flowus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await response.json().catch(() => ({ ok: false, error: { message: "无法解析响应" } }));
  return json as FlowusApiResponse<T>;
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
  return response.json() as Promise<FlowusApiResponse<{ connected: boolean; config: FlowusConfig | null }>>;
}

export async function disconnectFlowus(): Promise<FlowusApiResponse<{ connected: boolean }>> {
  const response = await fetch("/api/flowus/config", { method: "DELETE" });
  return response.json() as Promise<FlowusApiResponse<{ connected: boolean }>>;
}

export async function updateFlowusConfigClient(
  config: Partial<FlowusConfig>,
): Promise<FlowusApiResponse<{ config: FlowusConfig }>> {
  const response = await fetch("/api/flowus/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  return response.json() as Promise<FlowusApiResponse<{ config: FlowusConfig }>>;
}

export async function searchFlowusDatabases(query: string): Promise<FlowusApiResponse<{ results: { id: string; title: string }[] }>> {
  return post("search_databases", { query });
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

export async function createFlowusTodo(title: string, options: { status?: string; note?: string; databaseId?: string } = {}) {
  return post<{ id: string; title: string }>("create_todo", { title, ...options });
}

export async function queryFlowusTodo(options: { status?: string; databaseId?: string } = {}) {
  return post<{ results: unknown[]; nextCursor: string | null; hasMore: boolean }>("query_todo", options);
}

export async function updateFlowusTodo(
  pageId: string,
  options: { completed?: boolean; status?: string; note?: string },
) {
  return post<{ id: string; title: string }>("update_todo", { pageId, ...options });
}

export async function searchFlowus(query: string) {
  return post<{ results: unknown[]; nextCursor: string | null; hasMore: boolean }>("search", { query });
}

export async function semanticSearchFlowus(query: string) {
  return post<{ results: { pageId: string; title: string; snippet: string; score: number; url: string }[] }>("semantic_search", { query });
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
