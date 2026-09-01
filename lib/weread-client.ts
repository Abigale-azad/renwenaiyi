// lib/weread-client.ts — 微信读书共读 · 前端瘦客户端。
// 只访问本项目 /api/weread 路由；不持有任何 API Key，不直连微信读书。

import type {
    WereadAction,
    WereadApiError,
    WereadBookmarkListResult,
    WereadBookInfo,
    WereadChapterListResult,
    WereadClientResult,
    WereadProgress,
    WereadReviewListResult,
    WereadSearchResult,
    WereadShelfResult,
} from "./weread-types";

const WEREAD_API_URL = "/api/weread";

/** 鉴权失败（服务端 WEREAD_API_KEY 失效）时的专用错误码，前端据此提示重新授权。 */
export const WEREAD_UNAUTHORIZED_CODE = "weread_unauthorized";

function toError(payload: unknown): WereadApiError {
    if (payload && typeof payload === "object" && "error" in payload) {
        const error = (payload as { error?: unknown }).error;
        if (error && typeof error === "object") {
            const record = error as Record<string, unknown>;
            return {
                code: typeof record.code === "string" ? record.code : "weread_unknown",
                message: typeof record.message === "string" ? record.message : "微信读书接口调用失败。",
                ...(typeof record.errcode === "number" ? { errcode: record.errcode } : {}),
            };
        }
    }
    return { code: "weread_unknown", message: "微信读书接口调用失败。" };
}

async function callWeread<T>(action: WereadAction, params: Record<string, unknown> = {}): Promise<WereadClientResult<T>> {
    try {
        const response = await fetch(WEREAD_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...params }),
            cache: "no-store",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (payload && typeof payload === "object" && "ok" in payload) {
            const record = payload as { ok?: unknown; data?: unknown };
            if (record.ok === true) return { ok: true, data: record.data as T };
        }
        return { ok: false, error: toError(payload) };
    } catch {
        return { ok: false, error: { code: "weread_network", message: "无法连接本服务 /api/weread 接口。" } };
    }
}

export function fetchWereadShelf(): Promise<WereadClientResult<WereadShelfResult>> {
    return callWeread("shelf");
}

export function searchWeread(keyword: string, count = 15): Promise<WereadClientResult<WereadSearchResult>> {
    return callWeread("search", { keyword, count });
}

export function fetchWereadBookInfo(bookId: string): Promise<WereadClientResult<WereadBookInfo>> {
    return callWeread("bookInfo", { bookId });
}

export function fetchWereadChapters(bookId: string): Promise<WereadClientResult<WereadChapterListResult>> {
    return callWeread("chapters", { bookId });
}

export function fetchWereadProgress(bookId: string): Promise<WereadClientResult<WereadProgress>> {
    return callWeread("progress", { bookId });
}

export function fetchWereadBookmarks(bookId: string): Promise<WereadClientResult<WereadBookmarkListResult>> {
    return callWeread("bookmarks", { bookId });
}

export function fetchWereadReviews(bookId: string): Promise<WereadClientResult<WereadReviewListResult>> {
    return callWeread("reviews", { bookId });
}

export function isWereadUnauthorized(error: WereadApiError): boolean {
    return error.code === WEREAD_UNAUTHORIZED_CODE;
}
