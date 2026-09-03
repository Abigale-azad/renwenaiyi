// lib/server/flowus-gateway.ts — FlowUs V2 API 网关客户端（仅服务端使用）。
// 官方文档：https://flowus.cn/developer-api/v2/zh/getting-started/overview
// 基础地址：https://api.flowus.cn/v2
// 鉴权：Authorization: Bearer <integration_token>
//
// 安全约束（必须长期维持）：
// 1. Integration Token 只从服务端 Cookie 解密读取，严禁进入前端代码、浏览器存储、日志或回包。
// 2. 只透传白名单内的 FlowUs 端点；未列出的路径一律拒绝。
// 3. 错误日志只记录错误码与官方 message，不记录请求头与完整请求体。

import { openFlowusCredential } from "./flowus-credential";

export type FlowusErrorCode =
  | "flowus_unconfigured"
  | "flowus_unauthorized"
  | "flowus_forbidden"
  | "flowus_not_found"
  | "flowus_rate_limited"
  | "flowus_timeout"
  | "flowus_network"
  | "flowus_upstream_error"
  | "flowus_invalid_response"
  | "flowus_disallowed_path";

export type FlowusGatewayResult<T> =
  | { ok: true; data: T; requestId?: string }
  | { ok: false; code: FlowusErrorCode; message: string; requestId?: string; upstreamCode?: string };

const FLOWUS_BASE_URL = "https://api.flowus.cn/v2";
const FLOWUS_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\?.*$/, "");
}

const PATH_ALLOWLIST: ReadonlySet<string> = new Set([
  "users/me",
  "users/:user_id",
  "pages/:page_id",
  "pages",
  "pages/:page_id",
  "databases/:database_id",
  "databases",
  "databases/:database_id/query",
  "search",
  "search/semantic",
  "files/upload-url",
]);

function isAllowedPath(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  if (segments.length === 0) return false;

  const candidatePatterns = [
    normalized,
    segments.slice(0, 1).join("/") + "/:id",
    segments.slice(0, 2).join("/") + "/:id",
  ];

  for (const pattern of candidatePatterns) {
    if (PATH_ALLOWLIST.has(pattern)) return true;
  }

  const dynamicPatterns = [
    /^users\/[^/]+$/,
    /^pages\/[^/]+$/,
    /^pages\/[^/]+\/move$/,
    /^pages\/[^/]+\/content\/markdown$/,
    /^pages\/[^/]+\/properties\/[^/]+$/,
    /^databases\/[^/]+$/,
    /^databases\/[^/]+\/query$/,
    /^blocks\/[^/]+$/,
    /^blocks\/[^/]+\/children$/,
  ];
  return dynamicPatterns.some((re) => re.test(normalized));
}

function describeNetworkError(err: unknown): { code: FlowusErrorCode; message: string } {
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "flowus_timeout", message: "FlowUs 接口超时（20 秒）。" };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/getaddrinfo|EAI_AGAIN|ENOTFOUND/i.test(message)) {
    return { code: "flowus_network", message: "FlowUs API 域名解析失败，请检查服务端网络。" };
  }
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return { code: "flowus_network", message: "无法连接 FlowUs API。" };
  }
  return { code: "flowus_network", message };
}

function mapHttpError(status: number, upstreamCode: string, message: string): FlowusErrorCode {
  if (status === 401) return "flowus_unauthorized";
  if (status === 403) return "flowus_forbidden";
  if (status === 404) return "flowus_not_found";
  if (status === 429) return "flowus_rate_limited";
  if (status >= 500) return "flowus_upstream_error";
  if (upstreamCode === "validation_error" || upstreamCode === "unsupported_filter" || upstreamCode === "unsupported_sort") return "flowus_upstream_error";
  return "flowus_upstream_error";
}

export async function flowusApiFetch<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: Record<string, unknown> | undefined,
  token: string,
): Promise<FlowusGatewayResult<T>> {
  if (!isAllowedPath(path)) {
    return { ok: false, code: "flowus_disallowed_path", message: `FlowUs 路径 ${path} 不在允许列表内。` };
  }

  const url = `${FLOWUS_BASE_URL}/${normalizePath(path)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLOWUS_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      cache: "no-store",
    };
    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    const requestId = isRecord(payload) && typeof payload.request_id === "string" ? payload.request_id : undefined;

    if (!isRecord(payload)) {
      return {
        ok: false,
        code: "flowus_invalid_response",
        message: "FlowUs 返回了无法解析的响应。",
        requestId,
      };
    }

    if (!response.ok) {
      const upstreamCode = typeof payload.code === "string" ? payload.code : "";
      const message = typeof payload.message === "string" && payload.message ? payload.message : `FlowUs 错误（HTTP ${response.status}）。`;
      const code = mapHttpError(response.status, upstreamCode, message);
      return { ok: false, code, message, requestId, upstreamCode };
    }

    return { ok: true, data: payload as T, requestId };
  } catch (err) {
    const { code, message } = describeNetworkError(err);
    return { ok: false, code, message };
  } finally {
    clearTimeout(timer);
  }
}

export async function flowusApiFetchWithAccount<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: Record<string, unknown> | undefined,
  credentialCookie: string | undefined,
  accountId: string,
): Promise<FlowusGatewayResult<T>> {
  const token = credentialCookie ? openFlowusCredential(credentialCookie, accountId) : null;
  if (!token) {
    return { ok: false, code: "flowus_unconfigured", message: "尚未绑定 FlowUs Token，请先在「连接」中配置。" };
  }
  return flowusApiFetch<T>(method, path, body, token);
}
