// lib/reading-companion-chat-handler.ts — 微信读书共读 · 聊天触发处理。
// 由 chat-room.tsx 的关键词旁路调用；把开始/讨论/结束的副作用收敛在这里，
// 保持 chat-room（6640 行高危文件）的改动最小。

import type { ChatSession } from "./chat-storage";
import { pushChatMessage } from "./chat-storage";
import { generateCompanionDiscussion, toDiscussHighlights } from "./reading-companion-engine";
import {
    appendRoleOpinion,
    loadHighlights,
    loadRoleProfile,
    loadSyncState,
    markHighlightsDiscussed,
} from "./reading-companion-library";
import {
    loadReadingCompanion,
    startReadingCompanion,
    stopReadingCompanion,
    updateReadingCompanion,
} from "./reading-companion-storage";
import { requestReadingCompanionSync } from "./reading-companion-sync";
import { searchWeread } from "./weread-client";

export type ReadingCompanionIntent = "start" | "discuss" | "end" | "none";

export function detectReadingCompanionIntent(text: string): ReadingCompanionIntent {
    // 结束优先匹配，避免"先不读了"被误判为开始
    if (/(?:先不|不再|不|别|结束|退出|停止)\s*(?:读了?|共读|读书)/.test(text)) return "end";
    if (/聊聊(?:刚才)?(?:看|读)?的|聊聊(?:这本书|这书|此书)/.test(text)) return "discuss";
    if (/陪我(?:一起)?读(?:书)|一起读(?:书)?|共读/.test(text)) return "start";
    return "none";
}

/** 从"陪我读书 三体"这样的文本里抽出书名（去掉触发词）。 */
function extractBookTitle(text: string): string | null {
    const stripped = text
        .replace(/陪我(?:一起)?读(?:书)?|一起读(?:书)?|共读/g, "")
        .replace(/^[，,。、\s]+|[，,。、\s]+$/g, "")
        .trim();
    return stripped || null;
}

function pushCompanionCard(session: ChatSession, status: "unconfigured" | "idle" | "ready" | "error" | "ended" = "idle"): void {
    const state = loadReadingCompanion();
    if (status === "unconfigured") {
        pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: "还没有连接微信读书。配置好 WEREAD_API_KEY 后，发送“陪我读书 [书名]”开始共读。",
            mediaType: "reading_companion_card",
            mediaData: { readingCompanionStatus: "unconfigured" },
        });
        return;
    }
    if (!state) return;
    pushChatMessage({
        sessionId: session.id,
        role: "assistant",
        content: state.book.title,
        mediaType: "reading_companion_card",
        mediaData: {
            readingCompanionBook: {
                bookId: state.book.bookId,
                title: state.book.title,
                ...(state.book.author ? { author: state.book.author } : {}),
                ...(state.book.coverUrl ? { coverUrl: state.book.coverUrl } : {}),
                ...(state.lastSynced?.chapterTitle ? { chapterTitle: state.lastSynced.chapterTitle } : {}),
                ...(state.lastSynced?.progress !== undefined ? { progress: state.lastSynced.progress } : {}),
            },
            readingCompanionStats: {
                ...(state.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}),
                ...(state.lastSynced ? { newHighlights: 0 } : {}),
                discussionCount: 0,
            },
            readingCompanionStatus: status,
        },
    });
}

/** 处理共读意图。返回 handled=true 时 chat-room 应跳过主聊天 LLM。 */
export async function handleReadingCompanionIntent(
    intent: ReadingCompanionIntent,
    text: string,
    session: ChatSession,
): Promise<boolean> {
    if (session.isGroup) return false;

    if (intent === "end") {
        const state = loadReadingCompanion();
        if (!state?.active) return false;
        stopReadingCompanion();
        pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: `这次共读到这里。《${state.book.title}》的档案已经留存，下次发送“陪我读书 ${state.book.title}”可以接着读。`,
        });
        return true;
    }

    if (intent === "start") {
        const existing = loadReadingCompanion();
        if (existing?.active) {
            // 已在共读中：恢复 → 触发同步刷新
            void requestReadingCompanionSync();
            pushCompanionCard(session, "ready");
            return true;
        }
        const title = extractBookTitle(text);
        if (!title) {
            pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: "想和谁一起读？发送“陪我读书 [书名]”，比如“陪我读书 百年孤独”。书名来自你的微信读书书架。",
            });
            return true;
        }
        pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: `正在微信读书里找《${title}》…`,
        });
        const search = await searchWeread(title, 5);
        if (!search.ok) {
            const code = search.error.code;
            if (code === "weread_unconfigured" || code === "weread_unauthorized") {
                pushCompanionCard(session, "unconfigured");
            } else {
                pushChatMessage({
                    sessionId: session.id,
                    role: "assistant",
                    content: `微信读书搜索暂时不可用：${search.error.message}`,
                });
            }
            return true;
        }
        const first = search.data.items[0];
        if (!first) {
            pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: `在微信读书里没找到《${title}》。换个书名试试？`,
            });
            return true;
        }
        startReadingCompanion(session.id, session.contactId, {
            bookId: first.bookId,
            title: first.title,
            ...(first.author ? { author: first.author } : {}),
            ...(first.cover ? { coverUrl: first.cover } : {}),
        });
        pushCompanionCard(session, "idle");
        void requestReadingCompanionSync();
        return true;
    }

    if (intent === "discuss") {
        const state = loadReadingCompanion();
        if (!state?.active) return false; // 没在共读，不拦截，走正常对话
        updateReadingCompanion({ status: "syncing" });
        // 先补一次同步拿最新划线（零模型）
        await requestReadingCompanionSync();
        const syncState = await loadSyncState(state.book.bookId);
        const allHighlights = await loadHighlights(state.book.bookId);
        const undiscussed = allHighlights.filter(h => !h.discussedAt);
        const pool = undiscussed.length > 0 ? undiscussed : allHighlights.slice(-5);
        const profile = await loadRoleProfile(state.characterId, state.book.bookId);
        const contextHighlights = toDiscussHighlights(pool, syncState?.chapterTitles);
        const outcome = await generateCompanionDiscussion(session, {
            bookTitle: state.book.title,
            ...(state.book.author ? { author: state.book.author } : {}),
            ...(state.lastSynced?.chapterTitle ? { chapterTitle: state.lastSynced.chapterTitle } : {}),
            ...(state.lastSynced?.progress !== undefined ? { progress: state.lastSynced.progress } : {}),
            highlights: contextHighlights,
            ...(profile ? { roleProfile: profile } : {}),
        }, state.characterId);
        if (!outcome || !outcome.reply) {
            pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: "我翻了一下你最近的划线，一时没想好说什么。再读一会儿，或者直接告诉我你想聊哪段？",
            });
            return true;
        }
        pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: outcome.reply,
        });
        if (outcome.profileAction && outcome.profileAction.opinion) {
            await appendRoleOpinion(
                state.characterId,
                state.book.bookId,
                state.book.title,
                { summary: outcome.profileAction.opinion, basedOnHighlightIds: outcome.profileAction.basedOnHighlightIds },
            );
            await markHighlightsDiscussed(pool.map(h => h.id));
            updateReadingCompanion({ status: "ready" });
        }
        return true;
    }

    return false;
}
