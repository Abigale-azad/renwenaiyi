import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";
import { backupCharacterVersion } from "./character-version-storage";
import { loadCharacters, saveCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { loadCharacterRelationship, saveCharacterRelationship, type CharacterRelationshipProfile } from "./character-relationship-storage";

const BACKUP_KEY = "ai_phone_character_split_backups_v1";
registerKvMigration(BACKUP_KEY);

export type CharacterSplitDraft = {
  coreCard: string;
  realityFacts: string;
  relationshipBoundaries: string;
  allowedAddresses: string;
  intimacyProfile: string;
  scenarioProfile: string;
};

type SplitBackup = { character: Character; relationship: CharacterRelationshipProfile; createdAt: number };

function extractJson(text: string): CharacterSplitDraft {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回可识别的拆分结果，请重试。");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<CharacterSplitDraft>;
  const value = (key: keyof CharacterSplitDraft) => typeof parsed[key] === "string" ? parsed[key] as string : "";
  const draft = { coreCard: value("coreCard"), realityFacts: value("realityFacts"), relationshipBoundaries: value("relationshipBoundaries"), allowedAddresses: value("allowedAddresses"), intimacyProfile: value("intimacyProfile"), scenarioProfile: value("scenarioProfile") };
  if (!draft.coreCard.trim()) throw new Error("拆分结果缺少核心人物卡，请重试。");
  return draft;
}

export async function generateCharacterSplitDraft(character: Character): Promise<CharacterSplitDraft> {
  if (!character.persona?.trim()) throw new Error("当前人物卡没有可拆分的正文。");
  const slot = resolveBinding(loadBindingConfig(), character.id, "chat");
  if (!slot.apiConfigId) throw new Error("尚未给该角色绑定聊天 API。");
  const apiConfig = loadApiConfigs().find(item => item.id === slot.apiConfigId);
  if (!apiConfig) throw new Error("该角色绑定的 API 配置不存在。");
  const prompt = `你是严谨的角色档案迁移器。把下面的旧人物卡按用途拆开，保持原有语言细节与独特性，不美化、不续写、不推断现实中发生过任何事。\n\n【旧人物卡】\n${character.persona}\n\n只返回一个合法 JSON 对象，六个字段都必须是字符串：\n{\n  "coreCard": "身份、能力、稳定性格、日常生活、语言风格、外形等；删除具体亲密行为、虚构世界规则和未经确认的现实关系宣称",\n  "realityFacts": "原文中明确标为现实且可以长期保留的事实；无法确认则留空",\n  "relationshipBoundaries": "现实关系规则、称呼边界、禁止事项、进入退出条件",\n  "allowedAddresses": "原文明确允许的日常称呼，用中文逗号分隔；不确定则留空",\n  "intimacyProfile": "只放成人亲密偏好、触发条件、安全词、停止与事后照顾规则",\n  "scenarioProfile": "只放共感、里世界、AU、梦境等虚构世界规则"\n}\n要求：不得发明；重复内容去重；不要把示例中的虚构动作写进 realityFacts；coreCard 必须足够完整，不能把角色压缩成空泛摘要。`;
  const result = await simpleLLMCall(apiConfig, [{ role: "system", content: prompt }, { role: "user", content: `拆分「${character.name}」的人物卡。` }], { temperature: 0.1, max_tokens: 16384 });
  if (result.error || !result.content) throw new Error(result.error || "模型返回为空。");
  return extractJson(result.content);
}

function readBackups(): Record<string, SplitBackup> {
  try { return JSON.parse(kvGet(BACKUP_KEY) || "{}"); } catch { return {}; }
}

export function hasCharacterSplitBackup(characterId: string): boolean { return !!readBackups()[characterId]; }

export function applyCharacterSplit(character: Character, draft: CharacterSplitDraft): void {
  if (!draft.coreCard.trim()) throw new Error("核心人物卡不能为空。");
  const backups = readBackups();
  backups[character.id] = { character: JSON.parse(JSON.stringify(character)), relationship: loadCharacterRelationship(character.id), createdAt: Date.now() };
  kvSet(BACKUP_KEY, JSON.stringify(backups));
  backupCharacterVersion(character, "manual", "档案拆分前自动备份");
  saveCharacters(loadCharacters().map(item => item.id === character.id ? { ...item, persona: draft.coreCard.trim(), updatedAt: new Date().toISOString() } : item));
  const old = loadCharacterRelationship(character.id);
  saveCharacterRelationship(character.id, { ...old, allowedAddresses: draft.allowedAddresses.trim(), confirmedRealityFacts: draft.realityFacts.trim(), relationshipBoundaries: draft.relationshipBoundaries.trim(), intimacyProfile: draft.intimacyProfile.trim(), scenarioProfile: draft.scenarioProfile.trim(), updatedAt: Date.now() });
}

export function undoCharacterSplit(characterId: string): boolean {
  const backups = readBackups();
  const backup = backups[characterId];
  if (!backup) return false;
  saveCharacters(loadCharacters().map(item => item.id === characterId ? backup.character : item));
  saveCharacterRelationship(characterId, backup.relationship);
  delete backups[characterId];
  kvSet(BACKUP_KEY, JSON.stringify(backups));
  return true;
}
