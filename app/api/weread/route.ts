import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account-auth";
import { getWereadApiKey, wereadGatewayFetch, type WereadErrorCode } from "@/lib/server/weread-gateway";
import { openWereadCredential, WEREAD_CREDENTIAL_COOKIE } from "@/lib/server/weread-credential";
import {
    projectBookInfo,
    projectBookmarks,
    projectChapters,
    projectProgress,
    projectReviews,
    projectSearch,
    projectShelf,
} from "@/lib/server/weread-projections";

// 微信读书共读 · 接口层。
// 浏览器只允许访问本路由；官方网关调用与 WEREAD_API_KEY 全部收敛在服务端。
// 登录态由 middleware 全局拦截（联机模式）；单机模式（SELF_HOSTED）天然放行，不涉及账号系统。
// 响应统一为 { ok: true, data } 或 { ok: false, error: { code, message, errcode? } }。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_KEYWORD_LENGTH = 60;
const MAX_SEARCH_COUNT = 30;

const HTTP_STATUS_BY_CODE: Record<WereadErrorCode, number> = {
    weread_unconfigured: 503,
    weread_unauthorized: 401,
    weread_rate_limited: 429,
    weread_timeout: 504,
    weread_network: 502,
    weread_upstream_error: 502,
    weread_invalid_response: 502,
};

function ok(data: unknown) {
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
}

function fail(code: WereadErrorCode, message: string, errcode?: number) {
    return NextResponse.json(
        { ok: false, error: { code, message, ...(errcode !== undefined ? { errcode } : {}) } },
        { status: HTTP_STATUS_BY_CODE[code], headers: { "Cache-Control": "no-store" } },
    );
}

function badRequest(message: string) {
    return NextResponse.json(
        { ok: false, error: { code: "weread_bad_request", message } },
        { status: 400, headers: { "Cache-Control": "no-store" } },
    );
}

function readBookId(body: Record<string, unknown>): string {
    const raw = String(body.bookId ?? "").trim();
    return /^[\w.-]{1,120}$/.test(raw) ? raw : "";
}

export async function POST(request: NextRequest) {
    try {
        const account = await getCurrentAccount(request);
        if (!account) return NextResponse.json({ ok: false, error: { code: "weread_unauthorized", message: "请先登录小手机账号。" } }, { status: 401 });
        const apiKey = getWereadApiKey() || openWereadCredential(request.cookies.get(WEREAD_CREDENTIAL_COOKIE)?.value || "", account.id);
        if (!apiKey) return fail("weread_unconfigured", "请先到设置 → 微信读书共读连接账号。");

        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const action = String(body.action ?? "").trim();

        if (action === "shelf") {
            const result = await wereadGatewayFetch<unknown>("/shelf/sync", {}, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectShelf(result.data));
        }

        if (action === "search") {
            const keyword = String(body.keyword ?? "").trim().slice(0, MAX_KEYWORD_LENGTH);
            if (!keyword) return badRequest("缺少搜索关键词 keyword。");
            const countRaw = Number(body.count);
            const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.round(countRaw))) : 15;
            const result = await wereadGatewayFetch<unknown>("/store/search", { keyword, scope: 10, count }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectSearch(result.data));
        }

        if (action === "bookInfo") {
            const bookId = readBookId(body);
            if (!bookId) return badRequest("缺少有效的 bookId。");
            const result = await wereadGatewayFetch<unknown>("/book/info", { bookId }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectBookInfo(bookId, result.data));
        }

        if (action === "chapters") {
            const bookId = readBookId(body);
            if (!bookId) return badRequest("缺少有效的 bookId。");
            const result = await wereadGatewayFetch<unknown>("/book/chapterinfo", { bookId }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectChapters(result.data));
        }

        if (action === "progress") {
            const bookId = readBookId(body);
            if (!bookId) return badRequest("缺少有效的 bookId。");
            const result = await wereadGatewayFetch<unknown>("/book/getprogress", { bookId }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectProgress(result.data));
        }

        if (action === "bookmarks") {
            const bookId = readBookId(body);
            if (!bookId) return badRequest("缺少有效的 bookId。");
            const result = await wereadGatewayFetch<unknown>("/book/bookmarklist", { bookId }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectBookmarks(result.data));
        }

        if (action === "reviews") {
            const bookId = readBookId(body);
            if (!bookId) return badRequest("缺少有效的 bookId。");
            const result = await wereadGatewayFetch<unknown>("/review/list/mine", { bookid: bookId, count: 100 }, apiKey);
            if (!result.ok) return fail(result.code, result.message, result.errcode);
            return ok(projectReviews(result.data));
        }

        return badRequest(`未知 action：${action || "(空)"}。`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 日志只含通用描述，不含请求头/环境变量。
        console.error("[api/weread] unhandled error:", message);
        return fail("weread_upstream_error", "微信读书接口调用失败，请稍后再试。");
    }
}
