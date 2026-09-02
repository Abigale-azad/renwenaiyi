import { simpleLLMCall } from "./api-helpers";
import { loadWorldBooks, resolveAuxiliaryApiConfig } from "./settings-storage";
import type { WorldBookConfig } from "./settings-types";
import type { Character } from "./character-types";
import { loadNativeTimeline, formatTimelineForSummarization } from "./short-term-assembler";
import { addGrowthCandidate, approvedGrowthText, GROWTH_MARKER, isLegacyGrowthBook, loadCharacterGrowth } from "./character-growth-storage";
export const PERSONALITY_GROWTH_MARKER = GROWTH_MARKER;
export function getPersonalityGrowthCharacterId(book: WorldBookConfig): string | null {
  return isLegacyGrowthBook(book) ? book.description!.slice(GROWTH_MARKER.length) : null;
}
export function migrateCharacterGrowth(characterId: string) {
  // Copy only; preserve old books as recovery sources. Stable IDs make retries safe.
  for (const book of loadWorldBooks()) {
    if (getPersonalityGrowthCharacterId(book) !== characterId) continue;
    for (const entry of book.entries || []) {
      if (!entry.content.trim()) continue;
      addGrowthCandidate(characterId, { id: `legacy:${book.id}:${entry.uid}`, content: entry.content,
        createdAt: book.updatedAt || Date.now(), source: `旧成长簿：${book.name} / ${entry.comment}`,
        evidence: "旧版本未记录消息级证据。请核对后再采用，不代表已验证事实。" });
    }
  }
}
export function ensurePersonalityGrowthWorldBooks(characters: Character[]): WorldBookConfig[] {
  characters.forEach(character => migrateCharacterGrowth(character.id));
  return loadWorldBooks().filter(book => !isLegacyGrowthBook(book));
}
export function getAutomaticPersonalityWorldBookIds(_characterId: string): string[] { return []; }
const DEFAULT_PROMPT = `你是角色人格连续性编辑器，仅根据该角色亲身参与的互动生成候选成长。
使用四个标题：【逐渐稳定的人格特点】【对用户的新认识】【近期形成的相处方式】【需要避免的误判】。
每条说明支持它的具体事件；证据不足的推断明确标为“待观察”。区分用户原话、角色理解与推断。
不得将其他角色的经历当成当前角色的经历；不得将重置、删除等软件管理操作推断为共同经历或永久恐惧。
不得改写核心人物卡、身份、价值观和明确边界。不把一次性情绪固定成人格。不替用户做心理诊断。
合并仍然成立的已采用成长，结果300至700字。这是待用户确认的草稿，不是世界书。`;
const running = new Set<string>();
export async function updatePersonalityGrowthWorldBook(input: {
  characterId: string; characterName: string; recentEvents: string; factualSummary: string;
}): Promise<{ success: boolean; error?: string; bookId?: string }> {
  if (running.has(input.characterId)) return { success: false, error: "该角色正在整理成长" };
  const api = resolveAuxiliaryApiConfig("memorySummaryApiConfigId");
  if (!api) return { success: false, error: "未配置记忆总结 API" };
  running.add(input.characterId);
  try {
    migrateCharacterGrowth(input.characterId);
    if (loadCharacterGrowth(input.characterId).revisions.filter(r => r.status === "pending" && !r.id.startsWith("legacy:")).length >= 3)
      return { success: false, error: "已有3份候选待确认，请先审阅，避免重复调用" };
    const result = await simpleLLMCall(api, [{ role: "system", content: DEFAULT_PROMPT }, { role: "user", content:
      `角色：${input.characterName}\n已采用成长：${approvedGrowthText(input.characterId) || "无"}\n近期互动：\n${input.recentEvents}\n事实摘要：\n${input.factualSummary}` }], { temperature: 0.25 });
    if (!result.content?.trim() || result.wasTruncated) return { success: false, error: result.error || "结果为空或被截断，未写入" };
    addGrowthCandidate(input.characterId, { id: crypto.randomUUID(), content: result.content.trim(), createdAt: Date.now(),
      source: "该角色互动总结", evidence: input.factualSummary + "\n\n" + input.recentEvents });
    return { success: true };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
  finally { running.delete(input.characterId); }
}
export async function runManualPersonalityGrowth(input: { characterId: string; characterName: string }) {
  const entries = loadNativeTimeline(input.characterId);
  if (entries.length < 4) return { success: false, error: "至少需要4条该角色的互动记录" };
  const formatted = formatTimelineForSummarization(entries);
  if (!formatted?.eventsText) return { success: false, error: "没有可整理的互动" };
  return updatePersonalityGrowthWorldBook({ ...input, recentEvents: formatted.eventsText,
    factualSummary: `${formatted.earliest} 至 ${formatted.latest}，共${entries.length}条互动` });
}
