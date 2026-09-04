import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account-auth";
import {
  FLOWUS_CREDENTIAL_COOKIE,
  FLOWUS_CREDENTIAL_MAX_AGE,
  openFlowusCredential,
  sealFlowusCredential,
} from "@/lib/server/flowus-credential";
import { flowusApiFetch } from "@/lib/server/flowus-gateway";
import { deleteFlowusConfig, getFlowusConfig, upsertFlowusConfig } from "@/lib/server/flowus-config-db";
import type { FlowusUser } from "@/lib/flowus-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonHeaders = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const account = await getCurrentAccount(request);
  if (!account) {
    return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  }

  const stored = openFlowusCredential(request.cookies.get(FLOWUS_CREDENTIAL_COOKIE)?.value || "", account.id);
  const config = await getFlowusConfig(account.id);
  return NextResponse.json(
    { ok: true, connected: Boolean(stored), config: config ?? null },
    { headers: jsonHeaders },
  );
}

export async function POST(request: NextRequest) {
  const account = await getCurrentAccount(request);
  if (!account) {
    return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token || "").trim();

  if (!token || token.length > 4096) {
    return NextResponse.json({ ok: false, error: "请粘贴有效的 FlowUs Integration Token。" }, { status: 400, headers: jsonHeaders });
  }

  const tested = await flowusApiFetch<FlowusUser>("GET", "users/me", undefined, token);
  if (!tested.ok) {
    const status = tested.code === "flowus_unauthorized" ? 401 : tested.code === "flowus_rate_limited" ? 429 : 502;
    return NextResponse.json({ ok: false, error: tested.message }, { status, headers: jsonHeaders });
  }

  const sealed = sealFlowusCredential(token, account.id);
  if (!sealed) {
    return NextResponse.json({ ok: false, error: "服务端缺少凭据加密密钥，请检查部署环境变量。" }, { status: 503, headers: jsonHeaders });
  }

  const configResult = await upsertFlowusConfig(account.id, { connected: true });
  if (!configResult.ok) return NextResponse.json({ ok: false, error: configResult.error }, { status: 500, headers: jsonHeaders });
  const response = NextResponse.json({ ok: true, connected: true, config: configResult.data }, { headers: jsonHeaders });
  response.cookies.set(FLOWUS_CREDENTIAL_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FLOWUS_CREDENTIAL_MAX_AGE,
  });
  return response;
}

export async function PATCH(request: NextRequest) {
  const account = await getCurrentAccount(request);
  if (!account) {
    return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  }

  const stored = openFlowusCredential(request.cookies.get(FLOWUS_CREDENTIAL_COOKIE)?.value || "", account.id);
  if (!stored) {
    return NextResponse.json({ ok: false, error: "尚未绑定 FlowUs Token。" }, { status: 401, headers: jsonHeaders });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const configPatch = body.config as Record<string, unknown> | undefined;
  if (!configPatch) {
    return NextResponse.json({ ok: false, error: "缺少 config 字段。" }, { status: 400, headers: jsonHeaders });
  }

  const update = {
    parent_page_id: configPatch.parent_page_id ? String(configPatch.parent_page_id) : undefined,
    parent_page_title: configPatch.parent_page_title ? String(configPatch.parent_page_title) : undefined,
    inbox_database_id: configPatch.inbox_database_id ? String(configPatch.inbox_database_id) : undefined,
    inbox_database_title: configPatch.inbox_database_title ? String(configPatch.inbox_database_title) : undefined,
    todo_database_id: configPatch.todo_database_id ? String(configPatch.todo_database_id) : undefined,
    todo_database_title: configPatch.todo_database_title ? String(configPatch.todo_database_title) : undefined,
    todo_status_field: configPatch.todo_status_field ? String(configPatch.todo_status_field) : undefined,
    todo_done_value: configPatch.todo_done_value ? String(configPatch.todo_done_value) : undefined,
    character_scope: configPatch.character_scope === "character" ? "character" as const : "account" as const,
    allowed_character_ids: Array.isArray(configPatch.allowed_character_ids)
      ? configPatch.allowed_character_ids.filter((x): x is string => typeof x === "string")
      : undefined,
  };

  const configResult = await upsertFlowusConfig(account.id, update);
  if (!configResult.ok) return NextResponse.json({ ok: false, error: `保存配置失败：${configResult.error}` }, { status: 500, headers: jsonHeaders });
  return NextResponse.json({ ok: true, config: configResult.data }, { headers: jsonHeaders });
}

export async function DELETE(request: NextRequest) {
  const account = await getCurrentAccount(request);
  if (!account) {
    return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  }

  await deleteFlowusConfig(account.id);
  const response = NextResponse.json({ ok: true, connected: false }, { headers: jsonHeaders });
  response.cookies.set(FLOWUS_CREDENTIAL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
