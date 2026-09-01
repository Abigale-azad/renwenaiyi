import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account-auth";
import { getWereadApiKey, wereadGatewayFetch } from "@/lib/server/weread-gateway";
import {
  openWereadCredential,
  sealWereadCredential,
  WEREAD_CREDENTIAL_COOKIE,
  WEREAD_CREDENTIAL_MAX_AGE,
} from "@/lib/server/weread-credential";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonHeaders = { "Cache-Control": "no-store" };

async function accountFor(request: Request) {
  return getCurrentAccount(request);
}

export async function GET(request: NextRequest) {
  const account = await accountFor(request);
  if (!account) return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  if (getWereadApiKey()) return NextResponse.json({ ok: true, connected: true, source: "server" }, { headers: jsonHeaders });
  const stored = openWereadCredential(request.cookies.get(WEREAD_CREDENTIAL_COOKIE)?.value || "", account.id);
  return NextResponse.json({ ok: true, connected: Boolean(stored), source: stored ? "browser" : null }, { headers: jsonHeaders });
}

export async function POST(request: NextRequest) {
  const account = await accountFor(request);
  if (!account) return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey || apiKey.length > 4096) {
    return NextResponse.json({ ok: false, error: "请粘贴有效的微信读书 API Key。" }, { status: 400, headers: jsonHeaders });
  }
  const tested = await wereadGatewayFetch<unknown>("/shelf/sync", {}, apiKey);
  if (!tested.ok) return NextResponse.json({ ok: false, error: tested.message }, { status: tested.code === "weread_unauthorized" ? 401 : 502, headers: jsonHeaders });
  const sealed = sealWereadCredential(apiKey, account.id);
  if (!sealed) return NextResponse.json({ ok: false, error: "服务端缺少凭据加密密钥，请检查部署环境变量。" }, { status: 503, headers: jsonHeaders });
  const response = NextResponse.json({ ok: true, connected: true, source: "browser" }, { headers: jsonHeaders });
  response.cookies.set(WEREAD_CREDENTIAL_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEREAD_CREDENTIAL_MAX_AGE,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const account = await accountFor(request);
  if (!account) return NextResponse.json({ ok: false, error: "请先登录小手机账号。" }, { status: 401, headers: jsonHeaders });
  const response = NextResponse.json({ ok: true, connected: Boolean(getWereadApiKey()), source: getWereadApiKey() ? "server" : null }, { headers: jsonHeaders });
  response.cookies.set(WEREAD_CREDENTIAL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
