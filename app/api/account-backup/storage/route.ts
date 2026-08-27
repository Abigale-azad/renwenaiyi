import { NextResponse } from "next/server";

import { CLOUD_BACKUP_BUCKET } from "@/lib/cloud-backup/config";
import { getCurrentAccount } from "@/lib/server/account-auth";
import { getSupabaseServerConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanPath(value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.includes("..") || /[\u0000-\u001f]/.test(path)) throw new Error("invalid_path");
  return path;
}

function headers(key: string, contentType?: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function context(request: Request) {
  const account = await getCurrentAccount(request);
  const config = getSupabaseServerConfig();
  if (!account) throw new Error("unauthorized");
  if (!config) throw new Error("missing_supabase_env");
  return { account, config };
}

function objectPath(accountId: string, path: string): string {
  return `accounts/${encodeURIComponent(accountId)}/${cleanPath(path)}`;
}

async function ensureBucket(url: string, key: string): Promise<void> {
  const response = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(key, "application/json"),
    body: JSON.stringify({ id: CLOUD_BACKUP_BUCKET, name: CLOUD_BACKUP_BUCKET, public: false }),
  });
  if (response.ok || response.status === 409) return;
  const text = await response.text();
  if (/already exists|duplicate/i.test(text)) return;
  throw new Error(text || `bucket_${response.status}`);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message === "unauthorized" ? 401 : message === "invalid_path" ? 400 : 500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const { account, config } = await context(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    await ensureBucket(config.url, config.key);
    if (action === "ensure") return NextResponse.json({ ok: true });
    if (action !== "put") return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
    const path = objectPath(account.id, url.searchParams.get("path") || "");
    const body = await request.arrayBuffer();
    const response = await fetch(`${config.url}/storage/v1/object/${CLOUD_BACKUP_BUCKET}/${path}`, {
      method: "POST",
      headers: { ...headers(config.key, request.headers.get("content-type") || "application/octet-stream"), "x-upsert": "true" },
      body,
    });
    if (!response.ok) return new NextResponse(await response.text(), { status: response.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const { account, config } = await context(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    if (action === "get") {
      const path = objectPath(account.id, url.searchParams.get("path") || "");
      const response = await fetch(`${config.url}/storage/v1/object/${CLOUD_BACKUP_BUCKET}/${path}`, {
        headers: headers(config.key), cache: "no-store",
      });
      if (!response.ok) return new NextResponse(await response.text(), { status: response.status });
      return new NextResponse(response.body, { headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream" } });
    }
    if (action === "list") {
      const rawPrefix = url.searchParams.get("prefix") || "";
      const prefix = `accounts/${encodeURIComponent(account.id)}/${rawPrefix ? cleanPath(rawPrefix) : ""}`;
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const response = await fetch(`${config.url}/storage/v1/object/list/${CLOUD_BACKUP_BUCKET}`, {
        method: "POST",
        headers: headers(config.key, "application/json"),
        body: JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
        cache: "no-store",
      });
      if (!response.ok) return new NextResponse(await response.text(), { status: response.status });
      const rows = await response.json().catch(() => []);
      const normalized = (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => ({
        name: String(row.name ?? ""),
        size: Number((row.metadata as Record<string, unknown> | undefined)?.size ?? 0),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
      })).filter((row: { name: string }) => row.name);
      return NextResponse.json(normalized);
    }
    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { account, config } = await context(request);
    const url = new URL(request.url);
    const path = objectPath(account.id, url.searchParams.get("path") || "");
    const response = await fetch(`${config.url}/storage/v1/object/${CLOUD_BACKUP_BUCKET}/${path}`, {
      method: "DELETE", headers: headers(config.key),
    });
    if (response.ok || response.status === 404) return NextResponse.json({ ok: true });
    return new NextResponse(await response.text(), { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}
