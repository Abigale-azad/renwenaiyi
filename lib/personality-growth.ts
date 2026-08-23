import { simpleLLMCall } from "./api-helpers";
import {
    createWorldBook,
    loadWorldBooks,
    resolveAuxiliaryApiConfig,
    saveWorldBooks,
} from "./settings-storage";
import type { WorldBookConfig, WorldBookEntry } from "./settings-types";
import type { Character } from "./character-types";
import { loadNativeTimeline, formatTimelineForSummarization } from "./short-term-assembler";

export const PERSONALITY_GROWTH_MARKER = "auto-personality-growth:";
const CURRENT_ENTRY_COMMENT = "当前人格成长（自动生成）";
const MAX_HISTORY_ENTRIES = 12;

function markerFor(characterId: string): string {
    return `${PERSONALITY_GROWTH_MARKER}${characterId}`;
}

function makeEntry(input: Partial<WorldBookEntry> & Pick<WorldBookEntry, "uid" | "content" | "comment">): WorldBookEntry {
    return {
        uid: input.uid,
        key: input.key ?? "",
        content: input.content,
        comment: input.comment,
        use_regex: false,
        disable: input.disable ?? false,
        constant: input.constant ?? true,
        position: input.position ?? "after_char",
        depth: 0,
        probability: 100,
        useProbability: false,
        role: 0,
        insertion_order: input.insertion_order ?? 90,
    };
}

function findGrowthBook(books: WorldBookConfig[], characterId: string): WorldBookConfig | undefined {
    const marker = markerFor(characterId);
    return books.find(book => book.description === marker);
}

export function getPersonalityGrowthCharacterId(book: WorldBookConfig): string | null {
    const description = book.description || "";
    return description.startsWith(PERSONALITY_GROWTH_MARKER)
        ? description.slice(PERSONALITY_GROWTH_MARKER.length)
        : null;
}

export function ensurePersonalityGrowthWorldBooks(characters: Character[]): WorldBookConfig[] {
    const books = loadWorldBooks();
    const existingCharacterIds = new Set(
        books.map(getPersonalityGrowthCharacterId).filter((id): id is string => Boolean(id)),
    );
    const additions = characters
        .filter(character => !existingCharacterIds.has(character.id))
        .map(character => {
            const book = createWorldBook(`${character.name} · 人格成长簿`);
            return {
                ...book,
                description: markerFor(character.id),
                entries: [],
            };
        });
    if (additions.length === 0) return books;
    const next = [...books, ...additions];
    saveWorldBooks(next);
    return next;
}

export function getAutomaticPersonalityWorldBookIds(characterId: string): string[] {
    return loadWorldBooks()
        .filter(book => book.description === markerFor(characterId))
        .map(book => book.id);
}

export async function updatePersonalityGrowthWorldBook(input: {
    characterId: string;
    characterName: string;
    recentEvents: string;
    factualSummary: string;
}): Promise<{ success: boolean; error?: string; bookId?: string }> {
    const apiConfig = resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
    if (!apiConfig) return { success: false, error: "未配置记忆总结 API" };

    const books = loadWorldBooks();
    const existingBook = findGrowthBook(books, input.characterId);
    const previous = existingBook?.entries.find(entry => entry.comment === CURRENT_ENTRY_COMMENT && !entry.disable)?.content.trim() || "（尚未形成）";
    const prompt = `你是角色人格连续性编辑器。请根据近期真实互动，更新“${input.characterName}”的可成长人格层。

已有成长人格：
${previous}

近期事件：
${input.recentEvents}

事实记忆摘要：
${input.factualSummary}

请输出一份可直接作为世界书注入的中文设定，严格使用以下四个标题：
【逐渐稳定的人格特点】
【对用户的新认识】
【近期形成的相处方式】
【需要避免的误判】

规则：
- 只写有近期互动证据、可能影响后续回应的内容；不确定就不写。
- 区分稳定倾向与一次性情绪，不把单次玩笑、争执或疲惫永久化。
- 这是核心角色卡之外的成长层，不得改写身份、价值观、硬性禁忌和用户明确规则。
- 保持角色的主体性，可以形成自己的判断与表达习惯；不要把人格写成一味讨好用户。
- 严肃议题优先讨论议题，不要强行转入恋爱表达。
- 合并已有成长人格中仍然成立的内容，删除已经被新证据明确推翻的内容。
- 总长度控制在300至700字，只输出设定正文，不要解释过程。`;

    const result = await simpleLLMCall(apiConfig, [{ role: "user", content: prompt }], { temperature: 0.25 });
    const content = result.content?.trim();
    if (!content) return { success: false, error: result.error || "人格成长结果为空" };
    if (result.wasTruncated) return { success: false, error: "人格成长结果被截断，已取消写入" };

    const now = Date.now();
    const book = existingBook || createWorldBook(`${input.characterName} · 人格成长簿`);
    const oldCurrent = book.entries.find(entry => entry.comment === CURRENT_ENTRY_COMMENT && !entry.disable);
    const history = book.entries
        .filter(entry => entry !== oldCurrent)
        .map(entry => ({ ...entry, disable: true, constant: false }))
        .slice(0, MAX_HISTORY_ENTRIES - 1);
    if (oldCurrent?.content.trim()) {
        history.unshift(makeEntry({
            uid: `growth-history-${now}`,
            content: oldCurrent.content,
            comment: `历史版本 ${new Date(now).toLocaleString("zh-CN", { hour12: false })}`,
            disable: true,
            constant: false,
            insertion_order: 89,
        }));
    }
    const current = makeEntry({
        uid: oldCurrent?.uid || `growth-current-${input.characterId}`,
        content,
        comment: CURRENT_ENTRY_COMMENT,
        disable: false,
        constant: true,
        insertion_order: 90,
    });
    const updatedBook: WorldBookConfig = {
        ...book,
        name: `${input.characterName} · 人格成长簿`,
        description: markerFor(input.characterId),
        updatedAt: now,
        entries: [current, ...history.slice(0, MAX_HISTORY_ENTRIES - 1)],
    };
    saveWorldBooks(existingBook
        ? books.map(item => item.id === updatedBook.id ? updatedBook : item)
        : [...books, updatedBook]);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("settings-worldbooks-updated"));
    }
    return { success: true, bookId: updatedBook.id };
}

export async function runManualPersonalityGrowth(input: {
    characterId: string;
    characterName: string;
}): Promise<{ success: boolean; error?: string; bookId?: string }> {
    const entries = loadNativeTimeline(input.characterId);
    if (entries.length < 4) return { success: false, error: "至少需要4条聊天或互动记录" };
    const formatted = formatTimelineForSummarization(entries);
    if (!formatted?.eventsText) return { success: false, error: "没有可整理的互动内容" };
    return updatePersonalityGrowthWorldBook({
        ...input,
        recentEvents: formatted.eventsText,
        factualSummary: `手动整理范围：${formatted.earliest} 至 ${formatted.latest}，共${entries.length}条互动。`,
    });
}
