// lib/weread-types.ts — 微信读书共读：接口层共享类型（前端/服务端共用）。
// 字段全部来自腾讯官方 Agent API 文档（github.com/Tencent/WeChatReading v1.0.4），
// 并经过服务端白名单裁剪：不包含任何账号标识（vid/userVid）、隐私（secret）、
// 付费（price/paid/payType）、他人数据等字段。

/** 裁剪后的书架条目（来自 /shelf/sync 的 books[]） */
export type WereadShelfBook = {
    bookId: string;
    title: string;
    author?: string;
    cover?: string;
    category?: string;
    deepLink?: string;
    readUpdateTime?: number;
    finishReading?: number;
};

export type WereadShelfResult = {
    books: WereadShelfBook[];
};

/** 裁剪后的搜索结果条目（来自 /store/search） */
export type WereadSearchItem = {
    bookId: string;
    title: string;
    author?: string;
    cover?: string;
    intro?: string;
    newRating?: number;
};

export type WereadSearchResult = {
    items: WereadSearchItem[];
    hasMore: boolean;
};

/** 裁剪后的书籍信息（来自 /book/info） */
export type WereadBookInfo = {
    bookId: string;
    title: string;
    author?: string;
    translator?: string;
    cover?: string;
    intro?: string;
    category?: string;
    publisher?: string;
    wordCount?: number;
    newRating?: number;
};

/** 裁剪后的章节条目（来自 /book/chapterinfo 的 chapters[]） */
export type WereadChapter = {
    chapterUid: number;
    chapterIdx: number;
    title: string;
    wordCount?: number;
    level?: number;
};

export type WereadChapterListResult = {
    chapters: WereadChapter[];
    chapterUpdateTime?: number;
};

/** 裁剪后的阅读进度（来自 /book/getprogress 的 book 对象）
 *  progress 为 0-100 整数：1 表示 1%（不是 100%），100 才是读完。 */
export type WereadProgress = {
    chapterUid?: number;
    chapterOffset?: number;
    progress?: number;
    updateTime?: number;
    recordReadingTime?: number;
};

/** 裁剪后的划线条目（来自 /book/bookmarklist 的 updated[]，已过滤书签） */
export type WereadBookmark = {
    bookmarkId: string;
    chapterUid: number;
    markText: string;
    createTime: number;
};

export type WereadBookmarkListResult = {
    items: WereadBookmark[];
    chapters: Array<{ chapterUid: number; chapterIdx: number; title: string }>;
};

/** 裁剪后的个人想法条目（来自 /review/list/mine 的 reviews[].review） */
export type WereadReviewItem = {
    reviewId: string;
    content: string;
    abstract?: string;
    chapterUid?: number;
    createTime: number;
};

export type WereadReviewListResult = {
    items: WereadReviewItem[];
    totalCount?: number;
};

/** 前端拿到的统一错误结构 */
export type WereadApiError = {
    code: string;
    message: string;
    errcode?: number;
};

export type WereadClientResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: WereadApiError };

export type WereadAction =
    | "shelf"
    | "search"
    | "bookInfo"
    | "chapters"
    | "progress"
    | "bookmarks"
    | "reviews";
