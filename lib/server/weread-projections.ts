// lib/server/weread-projections.ts — 微信读书接口回包的字段白名单裁剪。
// 目标：浏览器只能看到共读所需字段；账号标识（vid/userVid）、隐私（secret）、
// 付费（price/paid/payType）、他人数据（热门划线/公开点评）等一律剥离。

import type {
    WereadBookmark,
    WereadBookmarkListResult,
    WereadBookInfo,
    WereadChapter,
    WereadChapterListResult,
    WereadProgress,
    WereadReviewItem,
    WereadReviewListResult,
    WereadSearchItem,
    WereadSearchResult,
    WereadShelfBook,
    WereadShelfResult,
} from "@/lib/weread-types";

const MARK_TEXT_MAX = 500;
const REVIEW_CONTENT_MAX = 1000;
const INTRO_MAX_SEARCH = 200;
const INTRO_MAX_BOOK = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, maxChars?: number): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined;
    return maxChars && value.length > maxChars ? value.slice(0, maxChars) : value;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** /shelf/sync → 书架（电子书部分；有声书/专辑与文章收藏不参与共读，直接丢弃） */
export function projectShelf(payload: unknown): WereadShelfResult {
    const root = isRecord(payload) ? payload : {};
    const booksRaw = Array.isArray(root.books) ? root.books : [];
    const books: WereadShelfBook[] = [];
    for (const entry of booksRaw) {
        if (!isRecord(entry)) continue;
        const bookId = typeof entry.bookId === "string" ? entry.bookId : "";
        const title = typeof entry.title === "string" ? entry.title : "";
        if (!bookId || !title) continue;
        books.push({
            bookId,
            title,
            author: str(entry.author),
            cover: str(entry.cover),
            category: str(entry.category),
            deepLink: str(entry.deepLink),
            readUpdateTime: num(entry.readUpdateTime),
            finishReading: num(entry.finishReading),
        });
    }
    return { books };
}

/** /store/search → 搜索（只保留书籍分组中的条目，按共读需要裁剪 bookInfo） */
export function projectSearch(payload: unknown): WereadSearchResult {
    const root = isRecord(payload) ? payload : {};
    const results = Array.isArray(root.results) ? root.results : [];
    const items: WereadSearchItem[] = [];
    for (const group of results) {
        if (!isRecord(group) || !Array.isArray(group.books)) continue;
        for (const entry of group.books) {
            if (!isRecord(entry) || !isRecord(entry.bookInfo)) continue;
            const info = entry.bookInfo;
            const bookId = typeof info.bookId === "string" ? info.bookId : "";
            const title = typeof info.title === "string" ? info.title : "";
            if (!bookId || !title) continue;
            if (items.some(item => item.bookId === bookId)) continue;
            items.push({
                bookId,
                title,
                author: str(info.author),
                cover: str(info.cover),
                intro: str(info.intro, INTRO_MAX_SEARCH),
                newRating: num(info.newRating),
            });
        }
    }
    return {
        items,
        hasMore: num(root.hasMore) === 1,
    };
}

/** /book/info → 书籍信息 */
export function projectBookInfo(bookId: string, payload: unknown): WereadBookInfo {
    const root = isRecord(payload) ? payload : {};
    return {
        bookId,
        title: typeof root.title === "string" ? root.title : "",
        author: str(root.author),
        translator: str(root.translator),
        cover: str(root.cover),
        intro: str(root.intro, INTRO_MAX_BOOK),
        category: str(root.category),
        publisher: str(root.publisher),
        wordCount: num(root.wordCount),
        newRating: num(root.newRating),
    };
}

/** /book/chapterinfo → 章节目录（丢 price/paid/isMPChapter 等付费与来源字段） */
export function projectChapters(payload: unknown): WereadChapterListResult {
    const root = isRecord(payload) ? payload : {};
    const chaptersRaw = Array.isArray(root.chapters) ? root.chapters : [];
    const chapters: WereadChapter[] = [];
    for (const entry of chaptersRaw) {
        if (!isRecord(entry)) continue;
        const chapterUid = num(entry.chapterUid);
        const title = typeof entry.title === "string" ? entry.title : "";
        if (chapterUid === undefined || !title) continue;
        chapters.push({
            chapterUid,
            chapterIdx: num(entry.chapterIdx) ?? chapters.length,
            title,
            wordCount: num(entry.wordCount),
            level: num(entry.level),
        });
    }
    chapters.sort((a, b) => a.chapterIdx - b.chapterIdx);
    return { chapters, chapterUpdateTime: num(root.chapterUpdateTime) };
}

/** /book/getprogress → 阅读进度（progress 为 0-100 整数，1=1%） */
export function projectProgress(payload: unknown): WereadProgress {
    const root = isRecord(payload) ? payload : {};
    const book = isRecord(root.book) ? root.book : root;
    return {
        chapterUid: num(book.chapterUid),
        chapterOffset: num(book.chapterOffset),
        progress: num(book.progress),
        updateTime: num(book.updateTime),
        recordReadingTime: num(book.recordReadingTime),
    };
}

/** /book/bookmarklist → 划线（bookmarkId 稳定 ID；markText 截断；书签已被官方过滤） */
export function projectBookmarks(payload: unknown): WereadBookmarkListResult {
    const root = isRecord(payload) ? payload : {};
    const updated = Array.isArray(root.updated) ? root.updated : [];
    const items: WereadBookmark[] = [];
    for (const entry of updated) {
        if (!isRecord(entry)) continue;
        const bookmarkId = typeof entry.bookmarkId === "string" ? entry.bookmarkId : "";
        const markText = typeof entry.markText === "string" ? entry.markText : "";
        const chapterUid = num(entry.chapterUid);
        if (!bookmarkId || !markText || chapterUid === undefined) continue;
        items.push({
            bookmarkId,
            chapterUid,
            markText: markText.length > MARK_TEXT_MAX ? markText.slice(0, MARK_TEXT_MAX) : markText,
            createTime: num(entry.createTime) ?? 0,
        });
    }
    const chaptersRaw = Array.isArray(root.chapters) ? root.chapters : [];
    const chapters: WereadBookmarkListResult["chapters"] = [];
    for (const entry of chaptersRaw) {
        if (!isRecord(entry)) continue;
        const chapterUid = num(entry.chapterUid);
        const title = typeof entry.title === "string" ? entry.title : "";
        if (chapterUid === undefined || !title) continue;
        chapters.push({ chapterUid, chapterIdx: num(entry.chapterIdx) ?? 0, title });
    }
    return { items, chapters };
}

/** /review/list/mine → 个人想法（reviewId 稳定 ID；content/abstract 截断） */
export function projectReviews(payload: unknown): WereadReviewListResult {
    const root = isRecord(payload) ? payload : {};
    const reviewsRaw = Array.isArray(root.reviews) ? root.reviews : [];
    const items: WereadReviewItem[] = [];
    for (const entry of reviewsRaw) {
        // 官方结构：reviews[].review.{reviewId, content, abstract, ...}
        const review = isRecord(entry) && isRecord(entry.review) ? entry.review : (isRecord(entry) ? entry : null);
        if (!review) continue;
        const reviewId = typeof review.reviewId === "string" ? review.reviewId : "";
        const content = typeof review.content === "string" ? review.content : "";
        if (!reviewId || !content) continue;
        items.push({
            reviewId,
            content: content.length > REVIEW_CONTENT_MAX ? content.slice(0, REVIEW_CONTENT_MAX) : content,
            abstract: str(review.abstract, MARK_TEXT_MAX),
            chapterUid: num(review.chapterUid),
            createTime: num(review.createTime) ?? 0,
        });
    }
    return { items, totalCount: num(root.totalCount) };
}
