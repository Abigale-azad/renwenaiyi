// lib/server/weread-gateway.ts — 微信读书官方 Agent API 网关客户端（仅服务端使用）。
// 官方文档：https://github.com/Tencent/WeChatReading（Tencent 官方，v1.0.4）
// 统一入口：POST https://i.weread.qq.com/api/agent/gateway
// 鉴权：Authorization: Bearer $WEREAD_API_KEY
//
// 安全约束（必须长期维持）：
// 1. WEREAD_API_KEY 只从服务端环境变量读取，严禁进入前端代码、浏览器存储、日志或回包。
// 2. 只透传白名单内的只读端点；正文解密类接口一律不在白名单内。
// 3. 错误日志只记录错误码与官方 message，不记录请求头与完整请求体。

export type WereadErrorCode =
    | "weread_unconfigured"
    | "weread_unauthorized"
    | "weread_rate_limited"
    | "weread_timeout"
    | "weread_network"
    | "weread_upstream_error"
    | "weread_invalid_response";

export type WereadGatewayResult<T> =
    | { ok: true; data: T; upgradeInfo: { message?: string } | null }
    | { ok: false; code: WereadErrorCode; message: string; errcode?: number };

const WEREAD_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const WEREAD_SKILL_VERSION = "1.0.4";
const WEREAD_TIMEOUT_MS = 15_000;

/** 只允许共读需要的 7 个只读端点（官方 api_name 原样）。 */
export const WEREAD_ALLOWED_API_NAMES: ReadonlySet<string> = new Set([
    "/shelf/sync",
    "/store/search",
    "/book/info",
    "/book/chapterinfo",
    "/book/getprogress",
    "/book/bookmarklist",
    "/review/list/mine",
]);

export function getWereadApiKey(): string | null {
    const key = (process.env.WEREAD_API_KEY || "").trim();
    return key || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 官方鉴权失败特征：HTTP 401/403，或中文 message 命中鉴权关键词。 */
function looksUnauthorized(status: number, message: string): boolean {
    if (status === 401 || status === 403) return true;
    return /未登录|登录.*(过期|失效)|apikey|api key|鉴权|授权.*(失败|无效)/i.test(message);
}

function describeNetworkError(err: unknown): { code: WereadErrorCode; message: string } {
    if (err instanceof Error && err.name === "AbortError") {
        return { code: "weread_timeout", message: "微信读书接口超时（15 秒）。" };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/getaddrinfo|EAI_AGAIN|ENOTFOUND/i.test(message)) {
        return { code: "weread_network", message: "微信读书网关域名解析失败，请检查服务端网络。" };
    }
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(message)) {
        return { code: "weread_network", message: "无法连接微信读书网关。" };
    }
    return { code: "weread_network", message };
}

export async function wereadGatewayFetch<T>(
    apiName: string,
    params: Record<string, unknown> = {},
): Promise<WereadGatewayResult<T>> {
    if (!WEREAD_ALLOWED_API_NAMES.has(apiName)) {
        return { ok: false, code: "weread_upstream_error", message: `微信读书接口 ${apiName} 不在允许列表内。` };
    }
    const apiKey = getWereadApiKey();
    if (!apiKey) {
        return { ok: false, code: "weread_unconfigured", message: "服务端未配置 WEREAD_API_KEY 环境变量。" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEREAD_TIMEOUT_MS);
    try {
        const response = await fetch(WEREAD_GATEWAY_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ api_name: apiName, skill_version: WEREAD_SKILL_VERSION, ...params }),
            signal: controller.signal,
            cache: "no-store",
        });

        const text = await response.text();
        let payload: unknown = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = null;
            }
        }

        if (!isRecord(payload)) {
            return {
                ok: false,
                code: "weread_invalid_response",
                message: "微信读书网关返回了无法解析的响应。",
            };
        }

        const errcode = typeof payload.errcode === "number" ? payload.errcode : 0;
        const upstreamMessage = typeof payload.errmsg === "string" && payload.errmsg
            ? payload.errmsg
            : (typeof payload.message === "string" && payload.message ? payload.message : "");

        if (errcode !== 0 || !response.ok) {
            const message = upstreamMessage || `微信读书网关错误（HTTP ${response.status}）。`;
            if (response.status === 429) {
                return { ok: false, code: "weread_rate_limited", message: "微信读书接口繁忙或已限流，请稍后再试。", errcode };
            }
            if (looksUnauthorized(response.status, message)) {
                return { ok: false, code: "weread_unauthorized", message: "微信读书 API Key 已失效，需要重新授权。", errcode };
            }
            if (!response.ok && response.status >= 500) {
                return { ok: false, code: "weread_upstream_error", message, errcode };
            }
            return { ok: false, code: "weread_upstream_error", message, errcode };
        }

        // 官方约定：回包出现 upgrade_info 时需要按 message 指引升级 skill 版本。
        const upgradeInfo = isRecord(payload.upgrade_info)
            ? { message: typeof payload.upgrade_info.message === "string" ? payload.upgrade_info.message : undefined }
            : null;

        // 业务数据体：网关成功时把除 errcode/errmsg/upgrade_info 外的字段整体返回，由裁剪层过滤。
        return { ok: true, data: payload as T, upgradeInfo };
    } catch (err) {
        const { code, message } = describeNetworkError(err);
        return { ok: false, code, message };
    } finally {
        clearTimeout(timer);
    }
}
