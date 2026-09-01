// lib/reading-companion-types.ts — 微信读书共读 · 领域类型。
// 与 storage（KV 状态）/ library（Dexie 缓存）配套。
// 体积约束：markText/abstract ≤500 字、content ≤1000 字由服务端裁剪层保证；
// opinions ≤50 条、focusQuestions ≤30 条由 library 层保证；正文永不入库。

export type ReadingCompanionBook = {
    bookId: string;
    title: string;
    author?: string;
    coverUrl?: string;
    deepLink?: string;
};

export type ReadingCompanionStatus = "idle" | "syncing" | "ready" | "error";

/** 共读会话状态（KV: ai_phone_reading_companion_v1）
 *  一次共读绑定 sessionId + characterId + bookId，全局仅一条 active 记录。 */
export type ReadingCompanionState = {
    active: boolean;
    sessionId: string;
    characterId: string;
    book: ReadingCompanionBook;
    startedAt: number;
    lastSyncAt?: number;
    status: ReadingCompanionStatus;
    lastSynced?: {
        chapterUid?: number;
        chapterTitle?: string;
        progress?: number;
        updatedAt?: number;
    };
    syncError?: string;
    /** 服务端 WEREAD_API_KEY 失效时置 true，停止自动重试直到重新配置。 */
    needsReauth?: boolean;
    /** 指数退避：自动重试的最早时间。 */
    retryAt?: number;
};

/** 书架缓存条目（Dexie shelfBooks，可再生数据） */
export type CompanionShelfBook = {
    bookId: string;
    title: string;
    author?: string;
    coverUrl?: string;
    category?: string;
    deepLink?: string;
    readUpdateTime?: number;
    finishReading?: number;
    updatedAt: number;
};

export type CompanionHighlightKind = "bookmark" | "review";

/** 划线/想法（Dexie highlights，可再生数据）。
 *  稳定 ID：`${bookId}:bm_${官方bookmarkId}` / `${bookId}:rv_${官方reviewId}`。 */
export type CompanionHighlight = {
    id: string;
    bookId: string;
    kind: CompanionHighlightKind;
    /** 官方稳定 ID（bookmarkId / reviewId） */
    sourceId: string;
    chapterUid?: number;
    /** 划线原文（bookmark）或想法内容（review） */
    text: string;
    /** 想法对应的划线原文（仅 review 有） */
    abstract?: string;
    createTime: number;
    updatedAt: number;
    /** 被讨论过的时间（由讨论层写入，同步永不清除） */
    discussedAt?: number;
};

/** 角色共读档案（Dexie roleProfiles，不可再生数据 ★未来进云备份）。
 *  主键 `${characterId}:${bookId}`，角色与书双隔离。 */
export type CompanionRoleProfile = {
    key: string;
    characterId: string;
    bookId: string;
    bookTitle: string;
    opinions: Array<{
        summary: string;
        basedOnHighlightIds: string[];
        createdAt: number;
    }>;
    /** 滚动讨论摘要 ≤600 字 */
    discussionDigest?: string;
    /** 共同争论或关注的问题 */
    focusQuestions: Array<{
        question: string;
        raisedAt: number;
        resolvedAt?: number;
    }>;
    updatedAt: number;
};

/** 同步游标与章节标题缓存（Dexie syncState，可再生数据） */
export type CompanionSyncState = {
    bookId: string;
    lastSyncAt: number;
    consecutiveFailures: number;
    lastError?: string;
    /** chapterUid → 章节标题（来自官方 bookmarks 回包的 chapters 映射与首次章节目录） */
    chapterTitles?: Record<number, string>;
};
