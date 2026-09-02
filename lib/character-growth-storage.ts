import { kvGet, kvSet, registerKvMigration } from "./kv-db";
const KEY = "ai_phone_character_growth_v1";
registerKvMigration(KEY);
export const GROWTH_MARKER = "auto-personality-growth:";
export type GrowthRevision = { id: string; content: string; createdAt: number; status: "pending" | "approved" | "rejected" | "archived"; source: string; evidence: string };
export type CharacterGrowth = { revisions: GrowthRevision[]; allowOtherChats: boolean };
function readStore(): Record<string, CharacterGrowth> {
  const raw = kvGet(KEY);
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("成长档案格式异常，请先导出备份");
  return value;
}
export function loadCharacterGrowth(id: string): CharacterGrowth {
  const value = readStore()[id];
  return { revisions: Array.isArray(value?.revisions) ? value.revisions : [], allowOtherChats: value?.allowOtherChats === true };
}
function write(id: string, value: CharacterGrowth) {
  if (!id) throw new Error("缺少角色 ID");
  const store = readStore(); store[id] = value;
  kvSet(KEY, JSON.stringify(store));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("character-growth-updated"));
}
export function addGrowthCandidate(id: string, revision: Omit<GrowthRevision, "status">) {
  const state = loadCharacterGrowth(id);
  if (state.revisions.some(item => item.id === revision.id)) return;
  write(id, { ...state, revisions: [{ ...revision, status: "pending" }, ...state.revisions] });
}
export function decideGrowth(id: string, revisionId: string, approve: boolean, edited?: string) {
  const state = loadCharacterGrowth(id);
  const target = state.revisions.find(item => item.id === revisionId);
  if (!target) throw new Error("未找到成长版本");
  const content = (edited ?? target.content).trim();
  if (approve && !content) throw new Error("成长内容不能为空");
  if (approve) {
    write(id, { ...state, revisions: [{ ...target, id: crypto.randomUUID(), content, createdAt: Date.now(), status: "approved", source: `采用版本 ${target.id}` }, ...state.revisions.map(item => ({ ...item, status: item.status === "approved" ? "archived" as const : item.id === revisionId && item.status === "pending" ? "archived" as const : item.status }))] });
  } else {
    write(id, { ...state, revisions: state.revisions.map(item => item.id === revisionId ? { ...item, status: "rejected" } : item) });
  }
}
export function setOtherChatsPermission(id: string, allowed: boolean) { write(id, { ...loadCharacterGrowth(id), allowOtherChats: allowed }); }
export function mayReadOtherChats(id?: string): boolean {
  if (!id) return false;
  try { return loadCharacterGrowth(id).allowOtherChats; } catch { return false; }
}
export function approvedGrowthText(id: string): string {
  try { return loadCharacterGrowth(id).revisions.find(item => item.status === "approved")?.content || ""; } catch { return ""; }
}
export function isLegacyGrowthBook(book: { description?: string }): boolean { return (book.description || "").startsWith(GROWTH_MARKER); }
