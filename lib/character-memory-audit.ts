import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs } from "./settings-storage";
import { loadMemoryEntries, saveMemoryEntry } from "./memory-storage";
import type { MemoryEntry } from "./memory-types";

export type MemoryAuditAction = "reality" | "intimate" | "disable";
export type MemoryAuditItem = { id: string; content: string; action: MemoryAuditAction; reason: string; type: MemoryEntry["type"] };

function parseArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const start = fenced.indexOf("["); const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("体检结果无法解析，请重试");
  const parsed = JSON.parse(fenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("体检结果格式错误");
  return parsed;
}

export async function auditCharacterMemories(characterId: string): Promise<MemoryAuditItem[]> {
  const entries = (await loadMemoryEntries(characterId)).filter(entry => entry.metadata?.disabled !== true).slice(-120);
  if (!entries.length) return [];
  const api = loadApiConfigs().find(item => item.apiKey?.trim() && item.defaultModel?.trim());
  if (!api) throw new Error("还没有可用的 API 配置");
  const payload = entries.map(entry => ({ id: entry.id, type: entry.type, content: entry.content.slice(0, 1200) }));
  const prompt = `你是角色记忆审计器。逐条判断记忆应归入：reality（日常真实信息）、intimate（仅亲密演出内容）、disable（串了其他角色、把软件操作当共同经历、明显编造或无法挽救的混合污染）。不要因为含感情就判 intimate，只有明确性/身体/私密演出才是 intimate。输出JSON数组，严格保留id：[{"id":"","action":"reality|intimate|disable","reason":"一句话"}]。\n\n${JSON.stringify(payload)}`;
  const result = await simpleLLMCall(api, [{ role: "system", content: "只输出有效JSON。不要改写记忆。" }, { role: "user", content: prompt }], { temperature: 0.1, max_tokens: 6000 });
  if (!result.content || result.error) throw new Error(result.error || "记忆体检没有返回结果");
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return parseArray(result.content).map(raw => {
    const value = raw as Record<string, unknown>; const entry = byId.get(String(value.id));
    if (!entry) return null;
    const action: MemoryAuditAction = value.action === "intimate" || value.action === "disable" ? value.action : "reality";
    return { id: entry.id, content: entry.content, type: entry.type, action, reason: String(value.reason || "") };
  }).filter((item): item is MemoryAuditItem => Boolean(item));
}

export async function applyCharacterMemoryAudit(characterId: string, items: MemoryAuditItem[]): Promise<void> {
  const entries = await loadMemoryEntries(characterId); const decisions = new Map(items.map(item => [item.id, item]));
  for (const entry of entries) {
    const decision = decisions.get(entry.id); if (!decision) continue;
    await saveMemoryEntry({ ...entry, conversationMode: decision.action === "intimate" ? "intimate" : "reality", updatedAt: new Date().toISOString(), metadata: { ...entry.metadata, conversationMode: decision.action === "intimate" ? "intimate" : "reality", disabled: decision.action === "disable", auditReason: decision.reason, auditedAt: new Date().toISOString() } });
  }
}
