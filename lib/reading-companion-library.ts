// lib/reading-companion-library.ts — 微信读书共读 · Dexie 持久层。
// 孪生先例：lib/music-companion-library.ts（独立 Dexie 库 + 内存缓存）。
// 数据分级：roleProfiles 不可再生（模型生成的角色观点，未来进云备份）；
// shelfBooks / highlights / syncState 均可再生（可从微信读书重新同步）。
// 去重：以官方稳定 ID（bookmarkId/reviewId）拼复合主键，createTime 比对变更。

import Dexie from "dexie";

import type {
    CompanionHighlight,
    CompanionRoleProfile,
    CompanionShelfBook,
    CompanionSyncState,
} from "./reading-companion-types";
import type { WereadBookmark, WereadReviewItem } from "./weread-types";

const HIGHLIGHTS_PER_BOOK_HARD_LIMIT = 5000; // 异常防御上限（正常一本书划线远低于此）
const OPINIONS_LIMIT = 50;
const FOCUS_QUESTIONS_LIMIT = 30;
const DIGEST_MAX_CHARS = 600;

class ReadingCompanionDb extends Dexie {
    shelfBooks!: Dexie.Table<CompanionShelfBook, string>;
    highlights!: Dexie.Table<CompanionHighlight, string>;
    roleProfiles!: Dexie.Table<CompanionRoleProfile, string>;
    syncState!: Dexie.Table<CompanionSyncState, string>;

    constructor() {
        super("AiPhoneReadingCompanionDB");
        this.version(1).stores({
            shelfBooks: "bookId, updatedAt",
            highlights: "id, bookId, [bookId+kind], createTime, updatedAt",
            roleProfiles: "key, characterId, bookId, updatedAt",
            syncState: "bookId",
        });
    }
}

const db = new ReadingCompanionDb();

// ── 书架缓存 ──

export async function upsertShelfBooks(books: CompanionShelfBook[]): Promise<void> {
    if (books.length === 0) return;
    const now = Date.now();
    await db.shelfBooks.bulkPut(books.map(book => ({ ...book, updatedAt: now })));
}

export async function loadShelfBooks(): Promise<CompanionShelfBook[]> {
    return db.shelfBooks.orderBy("updatedAt").reverse().toArray();
}

// ── 划线/想法：增量合并 ──

export type HighlightMergeStats = {
    added: number;
    updated: number;
    unchanged: number;
    removed: number;
    keptDiscussed: number;
};

/** 把一次官方同步拉回的划线/想法合并入库。
 *  去重规则：稳定 ID（`${bookId}:bm_${bookmarkId}` / `${bookId}:rv_${reviewId}`）；
 *  createTime 与 text 均未变化 → 跳过（保留 discussedAt）；变化 → 更新；
 *  本地存在但本次回包没有 → 远端已删 → 一并删除（但已讨论过的保留，讨论档案不因删线失锚）。 */
export async function mergeHighlights(
    bookId: string,
    bookmarks: WereadBookmark[],
    reviews: WereadReviewItem[],
): Promise<HighlightMergeStats> {
    const now = Date.now();
    const incoming = new Map<string, CompanionHighlight>();

    for (const item of bookmarks) {
        const id = `${bookId}:bm_${item.bookmarkId}`;
        incoming.set(id, {
            id,
            bookId,
            kind: "bookmark",
            sourceId: item.bookmarkId,
            chapterUid: item.chapterUid,
            text: item.markText,
            createTime: item.createTime,
            updatedAt: now,
        });
    }
    for (const item of reviews) {
        const id = `${bookId}:rv_${item.reviewId}`;
        incoming.set(id, {
            id,
            bookId,
            kind: "review",
            sourceId: item.reviewId,
            chapterUid: item.chapterUid,
            text: item.content,
            ...(item.abstract ? { abstract: item.abstract } : {}),
            createTime: item.createTime,
            updatedAt: now,
        });
    }

    const existing = await db.highlights.where("bookId").equals(bookId).toArray();
    const existingIds = new Set(existing.map(item => item.id));

    const stats: HighlightMergeStats = { added: 0, updated: 0, unchanged: 0, removed: 0, keptDiscussed: 0 };

    const toPut: CompanionHighlight[] = [];
    for (const [id, next] of incoming) {
        const prev = existing.find(item => item.id === id);
        if (!prev) {
            toPut.push(next);
            stats.added += 1;
        } else if (prev.createTime !== next.createTime || prev.text !== next.text || prev.abstract !== next.abstract) {
            toPut.push({ ...next, discussedAt: prev.discussedAt });
            stats.updated += 1;
        } else {
            stats.unchanged += 1;
        }
    }

    // 远端删除的划线：已讨论过的保留（讨论档案的依据锚点），其余清理。
    for (const prev of existing) {
        if (incoming.has(prev.id)) continue;
        if (prev.discussedAt) {
            stats.keptDiscussed += 1;
            continue;
        }
        await db.highlights.delete(prev.id);
        stats.removed += 1;
    }

    if (toPut.length > 0) await db.highlights.bulkPut(toPut);

    // 异常防御：单书超硬上限时丢最旧的未讨论条目。
    const total = await db.highlights.where("bookId").equals(bookId).count();
    if (total > HIGHLIGHTS_PER_BOOK_HARD_LIMIT) {
        const overflow = total - HIGHLIGHTS_PER_BOOK_HARD_LIMIT;
        const oldest = await db.highlights.where("bookId").equals(bookId)
            .filter(item => !item.discussedAt)
            .sortBy("createTime");
        const ids = oldest.slice(0, overflow).map(item => item.id);
        if (ids.length > 0) await db.highlights.bulkDelete(ids);
    }

    return stats;
}

export async function loadHighlights(bookId: string): Promise<CompanionHighlight[]> {
    return db.highlights.where("bookId").equals(bookId).sortBy("createTime");
}

/** 自某时间点以来的新划线（未来讨论层注入用）。 */
export async function loadHighlightsSince(bookId: string, since: number): Promise<CompanionHighlight[]> {
    const all = await loadHighlights(bookId);
    return all.filter(item => item.createTime > since);
}

/** 讨论层调用：标记已讨论。 */
export async function markHighlightsDiscussed(ids: string[], at = Date.now()): Promise<void> {
    if (ids.length === 0) return;
    await db.highlights.bulkPut((await db.highlights.bulkGet(ids))
        .filter((item): item is CompanionHighlight => !!item)
        .map(item => ({ ...item, discussedAt: at })));
}

// ── 角色共读档案（不可再生 ★云备份边界：类型即备份格式） ──

export function roleProfileKey(characterId: string, bookId: string): string {
    return `${characterId}:${bookId}`;
}

export async function loadRoleProfile(characterId: string, bookId: string): Promise<CompanionRoleProfile | null> {
    return (await db.roleProfiles.get(roleProfileKey(characterId, bookId))) ?? null;
}

export async function loadRoleProfilesForCharacter(characterId: string): Promise<CompanionRoleProfile[]> {
    return (await db.roleProfiles.toArray())
        .filter(profile => profile.characterId === characterId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveRoleProfile(profile: CompanionRoleProfile): Promise<void> {
    const next: CompanionRoleProfile = {
        ...profile,
        opinions: profile.opinions.slice(-OPINIONS_LIMIT),
        focusQuestions: profile.focusQuestions.slice(-FOCUS_QUESTIONS_LIMIT),
        discussionDigest: profile.discussionDigest
            ? profile.discussionDigest.slice(-DIGEST_MAX_CHARS)
            : undefined,
        updatedAt: Date.now(),
    };
    await db.roleProfiles.put(next);
}

/** 讨论层调用：追加观点（FIFO ≤50）与争论问题（≤30）。 */
export async function appendRoleOpinion(
    characterId: string,
    bookId: string,
    bookTitle: string,
    opinion: { summary: string; basedOnHighlightIds: string[] },
    focusQuestions: Array<{ question: string; resolvedAt?: number }> = [],
): Promise<CompanionRoleProfile> {
    const key = roleProfileKey(characterId, bookId);
    const existing = await db.roleProfiles.get(key);
    const now = Date.now();
    const profile: CompanionRoleProfile = existing
        ? { ...existing, bookTitle }
        : { key, characterId, bookId, bookTitle, opinions: [], focusQuestions: [], updatedAt: now };
    profile.opinions = [...profile.opinions, { ...opinion, createdAt: now }].slice(-OPINIONS_LIMIT);
    profile.focusQuestions = [
        ...profile.focusQuestions,
        ...focusQuestions.map(item => ({ question: item.question, raisedAt: now, ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}) })),
    ].slice(-FOCUS_QUESTIONS_LIMIT);
    await saveRoleProfile(profile);
    return profile;
}

// ── 同步游标 ──

export async function loadSyncState(bookId: string): Promise<CompanionSyncState | null> {
    return (await db.syncState.get(bookId)) ?? null;
}

export async function saveSyncState(state: CompanionSyncState): Promise<void> {
    await db.syncState.put(state);
}

/** 合并章节标题缓存（来自 bookmarks 回包的 chapters 与首次章节目录）。 */
export async function mergeChapterTitles(bookId: string, chapters: Array<{ chapterUid: number; title: string }>): Promise<Record<number, string>> {
    const state = await loadSyncState(bookId);
    const merged: Record<number, string> = { ...(state?.chapterTitles || {}) };
    for (const chapter of chapters) merged[chapter.chapterUid] = chapter.title;
    await db.syncState.put({
        bookId,
        lastSyncAt: state?.lastSyncAt ?? 0,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        ...(state?.lastError ? { lastError: state.lastError } : {}),
        chapterTitles: merged,
    });
    return merged;
}
