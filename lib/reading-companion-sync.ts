// lib/reading-companion-sync.ts — 微信读书共读 · 增量同步引擎。
// 模式参考 lib/follow-up-service.ts 的后台服务形态（bg-timer + 事件）。
//
// 同步策略：
// - 启动 30 秒后首同步（错开应用启动高峰）
// - 每 10 分钟定时同步（仅 active 共读存在时）
// - 页面恢复可见且距上次 ≥3 分钟时补一次
// - 失败退避：连续失败 <3 次按下个周期重试；≥3 次退避 30 分钟
// - 鉴权失效（needsReauth）后停止自动重试，等重新配置
// - 全程零模型调用：只有 /api/weread 的 HTTP 请求与本地 Dexie 合并

import { bgSetInterval, bgSetTimeout } from "./bg-timer";
import {
    loadSyncState,
    mergeChapterTitles,
    mergeHighlights,
    saveSyncState,
    type HighlightMergeStats,
} from "./reading-companion-library";
import {
    loadReadingCompanion,
    updateReadingCompanion,
    READING_COMPANION_SYNC_EVENT,
} from "./reading-companion-storage";
import type { ReadingCompanionState } from "./reading-companion-types";
import {
    fetchWereadBookmarks,
    fetchWereadChapters,
    fetchWereadProgress,
    fetchWereadReviews,
    isWereadUnauthorized,
} from "./weread-client";

const FIRST_SYNC_DELAY_MS = 30_000;
const SYNC_TICK_MS = 60_000;
const SYNC_INTERVAL_MS = 10 * 60_000;
const VISIBLE_RESYNC_INTERVAL_MS = 3 * 60_000;
const BACKOFF_AFTER_REPEATED_FAILURES = 3;
const BACKOFF_MS = 30 * 60_000;

let stopTicker: (() => void) | null = null;
let stopInitialTimer: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let syncing = false;

export function startReadingCompanionSyncService(): void {
    if (stopTicker) return; // already running
    stopTicker = bgSetInterval(tick, SYNC_TICK_MS);
    stopInitialTimer = bgSetTimeout(() => {
        stopInitialTimer = null;
        void syncNow("startup");
    }, FIRST_SYNC_DELAY_MS);
    if (typeof window !== "undefined" && visibilityHandler === null) {
        visibilityHandler = () => {
            if (document.visibilityState !== "visible") return;
            const state = loadReadingCompanion();
            if (!state?.active) return;
            if (state.needsReauth || state.status === "syncing") return;
            const last = state.lastSyncAt ?? 0;
            if (Date.now() - last < VISIBLE_RESYNC_INTERVAL_MS) return;
            if (state.retryAt && Date.now() < state.retryAt) return;
            void syncNow("visible");
        };
        document.addEventListener("visibilitychange", visibilityHandler);
    }
}

export function stopReadingCompanionSyncService(): void {
    if (stopTicker) { stopTicker(); stopTicker = null; }
    if (stopInitialTimer) { stopInitialTimer(); stopInitialTimer = null; }
    if (visibilityHandler && typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
    }
}

/** 手动请求一次同步（绕过 10 分钟节流；仍受 needsReauth / 并发锁约束）。 */
export async function requestReadingCompanionSync(): Promise<{ ok: boolean; skipped?: string; state?: ReadingCompanionState | null }> {
    const state = loadReadingCompanion();
    if (!state?.active) return { ok: false, skipped: "no_active_companion" };
    if (state.needsReauth) return { ok: false, skipped: "needs_reauth" };
    if (syncing) return { ok: false, skipped: "syncing" };
    const result = await syncNow("manual");
    return { ok: result.ok, state: loadReadingCompanion() };
}

function tick(): void {
    const state = loadReadingCompanion();
    if (!state?.active) return;
    if (state.needsReauth || state.status === "syncing") return;
    if (state.retryAt && Date.now() < state.retryAt) return;
    const last = state.lastSyncAt ?? 0;
    if (Date.now() - last < SYNC_INTERVAL_MS) return;
    void syncNow("interval");
}

type SyncOutcome = { ok: boolean; stats?: HighlightMergeStats };

async function syncNow(trigger: "startup" | "interval" | "visible" | "manual"): Promise<SyncOutcome> {
    const state = loadReadingCompanion();
    if (!state?.active || syncing) return { ok: false };
    syncing = true;
    updateReadingCompanion({ status: "syncing" });
    const bookId = state.book.bookId;

    try {
        // 首次同步（无游标）时顺带拉一次章节目录，建立 chapterUid → 标题映射。
        const prior = await loadSyncState(bookId);
        const firstSync = !prior || prior.lastSyncAt === 0;

        const [progressResult, bookmarksResult, reviewsResult, chaptersResult] = await Promise.all([
            fetchWereadProgress(bookId),
            fetchWereadBookmarks(bookId),
            fetchWereadReviews(bookId),
            firstSync ? fetchWereadChapters(bookId) : Promise.resolve(null),
        ]);

        // 三个核心请求必须全部成功才算同步成功（部分成功会导致去重误删）。
        const failures = [progressResult, bookmarksResult, reviewsResult, ...(chaptersResult ? [chaptersResult] : [])].filter(r => !r.ok);
        if (failures.length > 0) {
            const first = failures[0];
            if (first.ok === false && isWereadUnauthorized(first.error)) {
                updateReadingCompanion({
                    status: "error",
                    needsReauth: true,
                    syncError: "微信读书 API Key 已失效，需要重新授权。",
                });
                return { ok: false };
            }
            throw new Error(first.ok === false ? first.error.message : "同步失败");
        }

        const progress = progressResult.ok ? progressResult.data : null;
        const bookmarks = bookmarksResult.ok ? bookmarksResult.data : null;
        const reviews = reviewsResult.ok ? reviewsResult.data : null;
        if (!progress || !bookmarks || !reviews) throw new Error("同步数据缺失");

        const stats = await mergeHighlights(bookId, bookmarks.items, reviews.items);

        let chapterTitles: Record<number, string> = {};
        if (chaptersResult && chaptersResult.ok) {
            chapterTitles = await mergeChapterTitles(bookId, chaptersResult.data.chapters);
        }
        if (bookmarks.chapters.length > 0) {
            chapterTitles = await mergeChapterTitles(bookId, bookmarks.chapters.map(c => ({ chapterUid: c.chapterUid, title: c.title })));
        }

        const now = Date.now();
        const previous = await loadSyncState(bookId);
        await saveSyncState({
            bookId,
            lastSyncAt: now,
            consecutiveFailures: 0,
            chapterTitles: { ...chapterTitles },
        });

        const chapterTitle = progress.chapterUid !== undefined
            ? chapterTitles[progress.chapterUid]
            : undefined;
        const nextState = updateReadingCompanion({
            status: "ready",
            lastSyncAt: now,
            lastSynced: {
                chapterUid: progress.chapterUid,
                ...(chapterTitle ? { chapterTitle } : {}),
                ...(progress.progress !== undefined ? { progress: progress.progress } : {}),
                ...(progress.updateTime !== undefined ? { updatedAt: progress.updateTime } : {}),
            },
            syncError: undefined,
            needsReauth: false,
            retryAt: undefined,
        });
        if (nextState && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(READING_COMPANION_SYNC_EVENT, {
                detail: { trigger, state: nextState, stats, previousFailures: previous?.consecutiveFailures ?? 0 },
            }));
        }
        return { ok: true, stats };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const previous = await loadSyncState(bookId);
        const failures = (previous?.consecutiveFailures ?? 0) + 1;
        const backoff = failures >= BACKOFF_AFTER_REPEATED_FAILURES;
        await saveSyncState({
            bookId,
            lastSyncAt: previous?.lastSyncAt ?? 0,
            consecutiveFailures: failures,
            lastError: message,
            chapterTitles: previous?.chapterTitles,
        });
        updateReadingCompanion({
            status: "error",
            syncError: message,
            ...(backoff ? { retryAt: Date.now() + BACKOFF_MS } : {}),
        });
        return { ok: false };
    } finally {
        syncing = false;
    }
}
