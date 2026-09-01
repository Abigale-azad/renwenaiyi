// lib/reading-companion-storage.ts — 微信读书共读 · 会话状态 KV 存储。
// 孪生先例：lib/music-companion-storage.ts（同为 kv-db 同步缓存 + 事件总线）。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { ReadingCompanionBook, ReadingCompanionState } from "./reading-companion-types";

const READING_COMPANION_KEY = "ai_phone_reading_companion_v1";

/** 同步完成事件（detail 为最新 ReadingCompanionState），供未来 UI 监听刷新。 */
export const READING_COMPANION_SYNC_EVENT = "reading-companion-synced";
/** 状态变化事件（start/update/stop 都会派发）。 */
export const READING_COMPANION_STATE_EVENT = "reading-companion-state-changed";

registerKvMigration(READING_COMPANION_KEY);

export function loadReadingCompanion(): ReadingCompanionState | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = kvGet(READING_COMPANION_KEY);
        const value = raw ? JSON.parse(raw) as Partial<ReadingCompanionState> : null;
        if (!value?.active || !value.sessionId || !value.characterId || !value.book?.bookId || !value.startedAt) return null;
        return value as ReadingCompanionState;
    } catch {
        return null;
    }
}

function persist(state: ReadingCompanionState): void {
    kvSet(READING_COMPANION_KEY, JSON.stringify(state));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(READING_COMPANION_STATE_EVENT, { detail: state }));
    }
}

/** 开始一次共读：绑定 会话 + 角色 + 书。若已有进行中共读会被直接覆盖（调用方负责先结束）。 */
export function startReadingCompanion(sessionId: string, characterId: string, book: ReadingCompanionBook): ReadingCompanionState {
    const state: ReadingCompanionState = {
        active: true,
        sessionId,
        characterId,
        book,
        startedAt: Date.now(),
        status: "idle",
    };
    persist(state);
    return state;
}

export function updateReadingCompanion(patch: Partial<ReadingCompanionState>): ReadingCompanionState | null {
    const current = loadReadingCompanion();
    if (!current) return null;
    const next = { ...current, ...patch };
    persist(next);
    return next;
}

/** 结束共读：清空状态（角色档案与划线缓存全部保留在 Dexie）。 */
export function stopReadingCompanion(): void {
    kvSet(READING_COMPANION_KEY, "");
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(READING_COMPANION_STATE_EVENT, { detail: null }));
    }
}

/** 重新授权成功后清除 needsReauth 并恢复自动同步。 */
export function clearReadingCompanionReauth(): ReadingCompanionState | null {
    return updateReadingCompanion({ needsReauth: false, retryAt: undefined, syncError: undefined });
}
