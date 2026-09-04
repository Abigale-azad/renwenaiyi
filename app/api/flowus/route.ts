import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account-auth";
import { FLOWUS_CREDENTIAL_COOKIE } from "@/lib/server/flowus-credential";
import { flowusApiFetchWithAccount, type FlowusErrorCode } from "@/lib/server/flowus-gateway";
import { getFlowusConfig } from "@/lib/server/flowus-config-db";
import {
  createFlowusOperation,
  listFlowusOperations,
  updateFlowusOperation,
} from "@/lib/server/flowus-operation-ledger";
import {
  buildPropertyValue,
  makeDatabaseSchema,
  makeParent,
  makeTitleProperty,
  projectDatabase,
  projectPage,
  projectPageList,
  projectSearchResults,
} from "@/lib/server/flowus-projections";
import type { FlowusConfig, FlowusDatabase, FlowusFilter, FlowusList, FlowusPage, FlowusSort } from "@/lib/flowus-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HTTP_STATUS_BY_CODE: Record<FlowusErrorCode | "flowus_unconfigured" | "flowus_bad_request", number> = {
  flowus_unconfigured: 400,
  flowus_unauthorized: 401,
  flowus_forbidden: 403,
  flowus_not_found: 404,
  flowus_rate_limited: 429,
  flowus_timeout: 504,
  flowus_network: 502,
  flowus_upstream_error: 502,
  flowus_invalid_response: 502,
  flowus_disallowed_path: 403,
  flowus_bad_request: 400,
};

const jsonHeaders = { "Cache-Control": "no-store" };

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data }, { headers: jsonHeaders });
}

function fail(code: FlowusErrorCode, message: string, requestId?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(requestId ? { requestId } : {}) } },
    { status: HTTP_STATUS_BY_CODE[code], headers: jsonHeaders },
  );
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: { code: "flowus_bad_request", message } }, { status: 400, headers: jsonHeaders });
}

function readCookie(request: NextRequest): string | undefined {
  return request.cookies.get(FLOWUS_CREDENTIAL_COOKIE)?.value;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCharacterAllowed(config: FlowusConfig | null, characterId: string | null): boolean {
  if (!config) return false;
  if (config.character_scope !== "character") return true;
  if (!characterId) return false;
  return config.allowed_character_ids?.includes(characterId) ?? false;
}

function requireCharacterPermission(config: FlowusConfig | null, characterId: string | null): NextResponse | null {
  if (!config) return fail("flowus_unconfigured", "尚未完成 FlowUs 配置，请先选择待办多维表和收藏收件箱。");
  if (!isCharacterAllowed(config, characterId)) {
    return fail("flowus_forbidden", "当前角色没有权限操作此 FlowUs 数据。");
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const account = await getCurrentAccount(request);
    if (!account) {
      return NextResponse.json({ ok: false, error: { code: "flowus_unauthorized", message: "请先登录小手机账号。" } }, { status: 401, headers: jsonHeaders });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = safeString(body.action);
    const characterId = safeString(body.characterId) || null;
    const cookie = readCookie(request);

    if (action === "get_config") {
      const config = await getFlowusConfig(account.id);
      return ok({ connected: Boolean(cookie), config });
    }

    if (action === "list_operations") {
      const limitRaw = Number(body.limit);
      const operations = await listFlowusOperations(account.id, {
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      return ok({ operations });
    }

    if (action === "get_me") {
      const result = await flowusApiFetchWithAccount<{ id: string; name?: string }>("GET", "users/me", undefined, cookie, account.id);
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok({ id: result.data.id, name: result.data.name ?? "" });
    }

    if (action === "search_databases") {
      const query = safeString(body.query) || "";
      const result = await flowusApiFetchWithAccount<FlowusList<FlowusPage | FlowusDatabase>>(
        "POST",
        "search",
        { query, filter: { value: "database", property: "object" } },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      const databases = (result.data.results ?? []).filter((r): r is FlowusDatabase => "object" in r && r.object === "database");
      return ok({ results: databases.map(projectDatabase) });
    }

    if (action === "search_pages") {
      const query = safeString(body.query) || "";
      const startCursor = safeString(body.startCursor) || undefined;
      const result = await flowusApiFetchWithAccount<FlowusList<FlowusPage | FlowusDatabase>>(
        "POST",
        "search",
        {
          query,
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          start_cursor: startCursor ?? null,
          page_size: 50,
        },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      const pages = (result.data.results ?? []).filter((r): r is FlowusPage => "object" in r && r.object === "page");
      return ok({
        results: pages.map((p) => ({ id: p.id, title: projectPage(p).title })),
        hasMore: Boolean(result.data.has_more),
        nextCursor: result.data.next_cursor ?? null,
      });
    }

    if (action === "get_page") {
      const pageId = safeString(body.pageId);
      if (!pageId) return badRequest("缺少 pageId。");
      const result = await flowusApiFetchWithAccount<FlowusPage>("GET", `pages/${pageId}`, undefined, cookie, account.id);
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPage(result.data));
    }

    if (action === "get_database") {
      const databaseId = safeString(body.databaseId);
      if (!databaseId) return badRequest("缺少 databaseId。");
      const result = await flowusApiFetchWithAccount<FlowusDatabase>("GET", `databases/${databaseId}`, undefined, cookie, account.id);
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectDatabase(result.data));
    }

    if (action === "query_database") {
      const databaseId = safeString(body.databaseId);
      if (!databaseId) return badRequest("缺少 databaseId。");
      const filter = body.filter as FlowusFilter | undefined;
      const sorts = Array.isArray(body.sorts) ? body.sorts as FlowusSort[] : undefined;
      const startCursor = safeString(body.startCursor) || undefined;
      const pageSizeRaw = Number(body.pageSize);
      const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.round(pageSizeRaw))) : 20;
      const result = await flowusApiFetchWithAccount<FlowusList<FlowusPage>>(
        "POST",
        `databases/${databaseId}/query`,
        { filter, sorts, start_cursor: startCursor ?? null, page_size: pageSize },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPageList(result.data));
    }

    if (action === "create_database_row") {
      const databaseId = safeString(body.databaseId);
      const title = safeString(body.title);
      const properties = body.properties as Record<string, unknown> | undefined;
      if (!databaseId) return badRequest("缺少 databaseId。");
      if (!title) return badRequest("缺少 title。");

      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;

      const op = await createFlowusOperation(account.id, {
        character_id: characterId,
        action: "create_database_row",
        status: "running",
        payload: { databaseId, title },
      });

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "POST",
        "pages",
        {
          parent: { database_id: databaseId },
          properties: { title: makeTitleProperty(title), ...(properties ?? {}) },
        },
        cookie,
        account.id,
      );

      if (!result.ok) {
        if (op?.id) await updateFlowusOperation(op.id, { status: "failed", upstream_error_code: result.upstreamCode, upstream_error_message: result.message });
        return fail(result.code, result.message, result.requestId);
      }

      if (op?.id) await updateFlowusOperation(op.id, { status: "success", result: { pageId: result.data.id } });
      return ok(projectPage(result.data));
    }

    if (action === "update_database_row") {
      const pageId = safeString(body.pageId);
      const properties = body.properties as Record<string, unknown> | undefined;
      if (!pageId) return badRequest("缺少 pageId。");

      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "PATCH",
        `pages/${pageId}`,
        { properties },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPage(result.data));
    }

    if (action === "archive_database_row") {
      const pageId = safeString(body.pageId);
      if (!pageId) return badRequest("缺少 pageId。");

      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "PATCH",
        `pages/${pageId}`,
        { archived: true },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPage(result.data));
    }

    if (action === "create_todo_database") {
      const parentPageId = safeString(body.parentPageId);
      const title = safeString(body.title) || "小手机待办";
      const result = await flowusApiFetchWithAccount<FlowusDatabase>(
        "POST",
        "databases",
        {
          parent: parentPageId ? { page_id: parentPageId } : { workspace: true },
          title: [{ type: "text", text: { content: title } }],
          properties: makeDatabaseSchema([
            { name: "Name", type: "title" },
            { name: "状态", type: "select" },
            { name: "来源角色", type: "rich_text" },
            { name: "备注", type: "rich_text" },
          ]),
        },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectDatabase(result.data));
    }

    if (action === "create_inbox_database") {
      const parentPageId = safeString(body.parentPageId);
      const title = safeString(body.title) || "小手机收件箱";
      const result = await flowusApiFetchWithAccount<FlowusDatabase>(
        "POST",
        "databases",
        {
          parent: parentPageId ? { page_id: parentPageId } : { workspace: true },
          title: [{ type: "text", text: { content: title } }],
          properties: makeDatabaseSchema([
            { name: "Name", type: "title" },
            { name: "内容", type: "rich_text" },
            { name: "来源角色", type: "rich_text" },
            { name: "标签", type: "multi_select" },
            { name: "原文链接", type: "url" },
          ]),
        },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectDatabase(result.data));
    }

    if (action === "create_todo") {
      const title = safeString(body.title);
      const status = safeString(body.status) || "待办";
      const note = safeString(body.note);
      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;
      const databaseId = safeString(body.databaseId) || config?.todo_database_id;
      if (!databaseId) return badRequest("未配置待办多维表，请先连接 FlowUs 并选择/创建待办表。");
      if (!title) return badRequest("缺少待办标题 title。");

      const properties: Record<string, unknown> = {
        Name: makeTitleProperty(title),
        状态: { select: { name: status } },
      };
      if (note) properties["备注"] = { rich_text: [{ type: "text", text: { content: note } }] };
      if (characterId) properties["来源角色"] = { rich_text: [{ type: "text", text: { content: characterId } }] };

      const op = await createFlowusOperation(account.id, {
        character_id: characterId,
        action: "create_todo",
        status: "running",
        payload: { databaseId, title, status },
      });

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "POST",
        "pages",
        { parent: { database_id: databaseId }, properties },
        cookie,
        account.id,
      );

      if (!result.ok) {
        if (op?.id) await updateFlowusOperation(op.id, { status: "failed", upstream_error_code: result.upstreamCode, upstream_error_message: result.message });
        return fail(result.code, result.message, result.requestId);
      }

      if (op?.id) await updateFlowusOperation(op.id, { status: "success", result: { pageId: result.data.id } });
      return ok(projectPage(result.data));
    }

    if (action === "query_todo") {
      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;
      const databaseId = safeString(body.databaseId) || config?.todo_database_id;
      if (!databaseId) return badRequest("未配置待办多维表。");
      const status = safeString(body.status);
      const filter: FlowusFilter | undefined = status
        ? { property: config?.todo_status_field || "状态", select: { equals: status } }
        : undefined;
      const result = await flowusApiFetchWithAccount<FlowusList<FlowusPage>>(
        "POST",
        `databases/${databaseId}/query`,
        { filter },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPageList(result.data));
    }

    if (action === "update_todo") {
      const pageId = safeString(body.pageId);
      const completed = body.completed;
      const status = safeString(body.status);
      const note = safeString(body.note);
      if (!pageId) return badRequest("缺少 pageId。");

      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;
      const properties: Record<string, unknown> = {};
      const statusField = config?.todo_status_field || "状态";
      if (typeof completed === "boolean") {
        properties[statusField] = { select: { name: completed ? (config?.todo_done_value || "完成") : "待办" } };
      } else if (status) {
        properties[statusField] = { select: { name: status } };
      }
      if (note) properties["备注"] = { rich_text: [{ type: "text", text: { content: note } }] };

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "PATCH",
        `pages/${pageId}`,
        { properties },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPage(result.data));
    }

    if (action === "search") {
      const query = safeString(body.query);
      if (!query) return badRequest("缺少搜索关键词 query。");
      const result = await flowusApiFetchWithAccount<FlowusList<FlowusPage | FlowusDatabase>>(
        "POST",
        "search",
        { query, page_size: 20 },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectPageList(result.data as FlowusList<FlowusPage>));
    }

    if (action === "semantic_search") {
      const query = safeString(body.query);
      if (!query) return badRequest("缺少搜索 query。");
      const result = await flowusApiFetchWithAccount<FlowusList<{ object: "search_result"; page_id: string; page_title?: string; score?: number; snippet?: string; url?: string }>>(
        "POST",
        "search/semantic",
        { query, page_size: 10 },
        cookie,
        account.id,
      );
      if (!result.ok) return fail(result.code, result.message, result.requestId);
      return ok(projectSearchResults(result.data));
    }

    if (action === "save_chat_favorite") {
      const title = safeString(body.title);
      const content = safeString(body.content);
      const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
      const url = safeString(body.url);
      const config = await getFlowusConfig(account.id);
      const forbidden = requireCharacterPermission(config, characterId);
      if (forbidden) return forbidden;
      const databaseId = safeString(body.databaseId) || config?.inbox_database_id;
      if (!databaseId) return badRequest("未配置收藏收件箱多维表。");
      if (!title && !content) return badRequest("至少需要 title 或 content。");

      const properties: Record<string, unknown> = {
        Name: makeTitleProperty(title || content.slice(0, 60)),
        内容: { rich_text: [{ type: "text", text: { content: content } }] },
        标签: { multi_select: tags.map((name) => ({ name })) },
      };
      if (characterId) properties["来源角色"] = { rich_text: [{ type: "text", text: { content: characterId } }] };
      if (url) properties["原文链接"] = { url };

      const op = await createFlowusOperation(account.id, {
        character_id: characterId,
        action: "save_chat_favorite",
        status: "running",
        payload: { databaseId, title, tags },
      });

      const result = await flowusApiFetchWithAccount<FlowusPage>(
        "POST",
        "pages",
        { parent: { database_id: databaseId }, properties },
        cookie,
        account.id,
      );

      if (!result.ok) {
        if (op?.id) await updateFlowusOperation(op.id, { status: "failed", upstream_error_code: result.upstreamCode, upstream_error_message: result.message });
        return fail(result.code, result.message, result.requestId);
      }

      if (op?.id) await updateFlowusOperation(op.id, { status: "success", result: { pageId: result.data.id } });
      return ok(projectPage(result.data));
    }

    return badRequest(`未知 action：${action || "(空)"}。`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/flowus] unhandled error:", message);
    return fail("flowus_upstream_error", "FlowUs 接口调用失败，请稍后再试。");
  }
}
