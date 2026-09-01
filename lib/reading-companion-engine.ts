// lib/reading-companion-engine.ts — 微信读书共读 · 讨论编排引擎。
// 模式参考 lib/reading-engine.ts 的 generateReadingChat（复用其 resolveReadingInput / callReadingLLM）。
//
// 核心原则（防捏造三道闸）：
// 1. 模型只见划线，不见正文（物理隔离）；
// 2. Prompt 硬约束：只有 [HL:...] 标注可称原文，其余必须联想口吻；
// 3. 结构化落档：观点与引文分离，档案页引文只从本地划线库渲染。
// 单次调用：一次"聊聊" = 一次模型调用；追问靠消息历史延续，不重复注入。

import type { ChatSession } from "./chat-storage";
import { loadChatMessages } from "./chat-storage";
import type { CompanionHighlight, CompanionRoleProfile } from "./reading-companion-types";
import { callReadingLLM, resolveReadingInput } from "./reading-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";

const HIGHLIGHTS_PER_DISCUSSION_LIMIT = 20;
const HIGHLIGHT_TEXT_MAX_IN_PROMPT = 120;
const PROFILE_BLOCK_TAG = "reading_profile";

export type CompanionDiscussHighlight = {
    id: string;
    text: string;
    chapterTitle?: string;
};

export type CompanionDiscussContext = {
    bookTitle: string;
    author?: string;
    chapterTitle?: string;
    progress?: number;
    /** 自上次讨论以来的新划线（已由调用方从 Dexhi 取出） */
    highlights: CompanionDiscussHighlight[];
    /** 该角色此书的既有档案（用于注入，无则空） */
    roleProfile?: CompanionRoleProfile | null;
};

export type CompanionDiscussionOutcome = {
    reply: string;
    profileAction?: {
        opinion: string;
        basedOnHighlightIds: string[];
    };
};

const ANTI_FABRICATION_INSTRUCTION = [
    "【共读讨论规则 · 必须遵守】",
    "1. 上面【你划过的原文】区块内标注 [HL:...] 的文字，是对方在微信读书里真实划下的原文。引用这些内容时原样保留，可称「你划过的」。",
    "2. 对这本书的任何其他感受、联想、评价，必须以「我联想到」「我觉得」「让我想到」等口吻表达。",
    "3. 严禁声称「书里写了」「作者在第X页说」「第N章提到」等具体情节或页码——你没有看到章节正文，只有划线。不要编造未出现在划线里的任何原文。",
    "4. 你可以自由联系自己的人设、经历、读过的其他书和既有记忆，赞同或反驳，但必须让读者清楚区分「这是书里的原文」与「这是你的联想」。",
    "5. 回复结尾附加结构化块用于更新你的共读档案（若无新观点可省略整个块）：",
    `<${PROFILE_BLOCK_TAG}>{"opinion":"你这次想表达的一句核心观点（≤80字）","basedOn":["HL:id","HL:id"]}</${PROFILE_BLOCK_TAG}>`,
    "basedOn 填你这次回复主要依据的划线 id（从上面 [HL:...] 标签里取），可空数组。",
].join("\n");

function formatHighlightsForPrompt(highlights: CompanionDiscussHighlight[]): string {
    if (highlights.length === 0) {
        return "（本次没有新的划线。可以聊聊整体进度、感受，或对这本书的印象。）";
    }
    const slice = highlights.slice(0, HIGHLIGHTS_PER_DISCUSSION_LIMIT);
    return slice.map((item, index) => {
        const text = item.text.length > HIGHLIGHT_TEXT_MAX_IN_PROMPT
            ? item.text.slice(0, HIGHLIGHT_TEXT_MAX_IN_PROMPT) + "…"
            : item.text;
        const chapter = item.chapterTitle ? `（${item.chapterTitle}）` : "";
        return `[HL:${item.id}]${chapter} ${text}`;
    }).join("\n\n") + (highlights.length > slice.length ? `\n\n…（还有 ${highlights.length - slice.length} 条划线未展示）` : "");
}

function formatRoleProfileForPrompt(profile: CompanionRoleProfile | null | undefined): string {
    if (!profile) return "（你还没有关于这本书的既有观点档案。这是第一次讨论。）";
    const digest = profile.discussionDigest?.trim()
        ? `既有讨论摘要：\n${profile.discussionDigest.trim()}`
        : "（暂无讨论摘要）";
    const opinions = profile.opinions.length > 0
        ? profile.opinions.slice(-5).map((o, i) => `${i + 1}. ${o.summary}`).join("\n")
        : "（暂无既有观点）";
    return `${digest}\n\n既有观点（最近 5 条）：\n${opinions}`;
}

function parseProfileBlock(raw: string): { opinion: string; basedOnHighlightIds: string[] } | null {
    const tag = PROFILE_BLOCK_TAG;
    const re = new RegExp(`<${tag}>\\s*(\\{[\\s\\S]*?\\})\\s*</${tag}>`, "i");
    const match = re.exec(raw);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]) as { opinion?: unknown; basedOn?: unknown };
        const opinion = typeof parsed.opinion === "string" ? parsed.opinion.trim().slice(0, 80) : "";
        const basedOn = Array.isArray(parsed.basedOn)
            ? parsed.basedOn.filter((v): v is string => typeof v === "string").map(s => s.replace(/^HL:/i, "").trim()).filter(Boolean)
            : [];
        if (!opinion) return null;
        return { opinion, basedOnHighlightIds: basedOn };
    } catch {
        return null;
    }
}

export async function generateCompanionDiscussion(
    session: ChatSession,
    context: CompanionDiscussContext,
    characterId: string,
): Promise<CompanionDiscussionOutcome | null> {
    const chapterTitle = context.chapterTitle?.trim() || "当前章节";
    const progress = typeof context.progress === "number" ? `${context.progress}%` : "未知";

    // 把划线摘要 + 角色档案拼成 resolveReadingInput 需要的 chapterContent / annotationHistory。
    // 注意：chapterContent 字段会被 prompt 装配器放进上下文，但内容是划线摘要而非正文——
    // 防捏造靠下面的 ANTI_FABRICATION_INSTRUCTION 显式说明，不靠字段名隐含语义。
    const chapterContent = [
        "【你划过的原文】（仅以下标注 [HL:...] 的文字是对方真实划下的，其余内容你不要当作原文）",
        formatHighlightsForPrompt(context.highlights),
        "",
        `当前阅读位置：${chapterTitle} · 进度 ${progress}`,
    ].join("\n");

    const annotationHistory = formatRoleProfileForPrompt(context.roleProfile);

    const resolved = await resolveReadingInput(characterId, ["reading", "companion_discuss"], {
        bookTitle: context.bookTitle,
        chapterTitle,
        chapterContent,
        annotationHistory,
        history: loadChatMessages(session.id),
    });
    if (!resolved || !resolved.apiConfig) return null;

    const llmMessages: LLMMessage[] = assemblePromptPayload(resolved.input);
    // 在装配好的消息末尾追加防捏造与结构化输出指令（仿 follow-up-service plannerInstruction 模式）。
    llmMessages.push({ role: "system", content: ANTI_FABRICATION_INSTRUCTION });

    const rawReply = await callReadingLLM(
        resolved.apiConfig,
        resolved.preset,
        llmMessages,
        resolved.input.character.name,
        resolved.input.regexes,
        resolved.input.appTags,
        resolved.input.userIdentity?.name,
    );
    if (!rawReply) return null;

    const profileAction = parseProfileBlock(rawReply);
    // 从回复中剥离结构化块，避免把 <reading_profile>...</reading_profile> 显示给用户。
    const reply = profileAction
        ? rawReply.replace(new RegExp(`<${PROFILE_BLOCK_TAG}>[\\s\\S]*?</${PROFILE_BLOCK_TAG}>`, "gi"), "").trim()
        : rawReply.trim();

    return { reply, ...(profileAction ? { profileAction } : {}) };
}

/** 从 Dexie 划线记录构造讨论上下文用的 highlights（截断 + 章节标题补全）。 */
export function toDiscussHighlights(highlights: CompanionHighlight[], chapterTitles?: Record<number, string>): CompanionDiscussHighlight[] {
    return highlights.map(item => ({
        id: item.sourceId,
        text: item.text,
        ...(item.chapterUid !== undefined && chapterTitles?.[item.chapterUid]
            ? { chapterTitle: chapterTitles[item.chapterUid] }
            : {}),
    }));
}
