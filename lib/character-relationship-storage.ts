import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const CHARACTER_RELATIONSHIP_KEY = "ai_phone_character_relationship_v1";
export const CHARACTER_RELATIONSHIP_UPDATED_EVENT = "character-relationship-updated";
registerKvMigration(CHARACTER_RELATIONSHIP_KEY);

export type CharacterChatMode = "reality" | "flirt" | "intimate" | "scenario";
export type RelationshipStage = "new" | "familiar" | "ambiguous" | "confirmed_online" | "confirmed_real";

export type CharacterRelationshipProfile = {
  relationshipStage: RelationshipStage;
  allowedAddresses: string;
  confirmedRealityFacts: string;
  relationshipBoundaries: string;
  intimacyProfile: string;
  scenarioProfile: string;
  currentMode: CharacterChatMode;
  updatedAt: number;
};

const DEFAULT_PROFILE: CharacterRelationshipProfile = {
  relationshipStage: "new",
  allowedAddresses: "",
  confirmedRealityFacts: "",
  relationshipBoundaries: "",
  intimacyProfile: "",
  scenarioProfile: "",
  currentMode: "reality",
  updatedAt: 0,
};

function readStore(): Record<string, Partial<CharacterRelationshipProfile>> {
  try {
    const raw = kvGet(CHARACTER_RELATIONSHIP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isMode(value: unknown): value is CharacterChatMode {
  return value === "reality" || value === "flirt" || value === "intimate" || value === "scenario";
}

function isStage(value: unknown): value is RelationshipStage {
  return value === "new" || value === "familiar" || value === "ambiguous" || value === "confirmed_online" || value === "confirmed_real";
}

export function loadCharacterRelationship(characterId: string): CharacterRelationshipProfile {
  const saved = readStore()[characterId] || {};
  return {
    ...DEFAULT_PROFILE,
    ...saved,
    relationshipStage: isStage(saved.relationshipStage) ? saved.relationshipStage : DEFAULT_PROFILE.relationshipStage,
    currentMode: isMode(saved.currentMode) ? saved.currentMode : DEFAULT_PROFILE.currentMode,
  };
}

export function saveCharacterRelationship(characterId: string, value: CharacterRelationshipProfile): void {
  if (!characterId) throw new Error("缺少角色 ID");
  const store = readStore();
  store[characterId] = { ...value, updatedAt: Date.now() };
  kvSet(CHARACTER_RELATIONSHIP_KEY, JSON.stringify(store));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHARACTER_RELATIONSHIP_UPDATED_EVENT, { detail: { characterId } }));
}

export function setCharacterChatMode(characterId: string, mode: CharacterChatMode): CharacterRelationshipProfile {
  const next = { ...loadCharacterRelationship(characterId), currentMode: mode, updatedAt: Date.now() };
  saveCharacterRelationship(characterId, next);
  return next;
}

const STAGE_LABELS: Record<RelationshipStage, string> = {
  new: "刚认识",
  familiar: "熟悉中",
  ambiguous: "暧昧中",
  confirmed_online: "已确认线上关系",
  confirmed_real: "已由用户确认现实关系",
};

export const CHAT_MODE_LABELS: Record<CharacterChatMode, string> = {
  reality: "现实",
  flirt: "暧昧",
  intimate: "亲密",
  scenario: "情境",
};

export function buildCharacterRelationshipPrompt(characterId: string): string {
  const profile = loadCharacterRelationship(characterId);
  const relationship = [
    `关系阶段：${STAGE_LABELS[profile.relationshipStage]}`,
    profile.allowedAddresses.trim() ? `用户明确允许的称呼：${profile.allowedAddresses.trim()}` : "用户未登记任何长期亲昵称呼；不要自行使用老公、老婆、宝贝等关系称呼。",
    profile.confirmedRealityFacts.trim() ? `用户确认的现实事实：\n${profile.confirmedRealityFacts.trim()}` : "没有额外登记的现实共同经历。",
    profile.relationshipBoundaries.trim() ? `关系边界：\n${profile.relationshipBoundaries.trim()}` : "关系按普通现实社交规则推进，不自动升级。",
  ].join("\n");

  if (profile.currentMode === "flirt") {
    return `【结构化当前模式：暧昧聊天｜用户已在界面开启】\n${relationship}\n可以表达吸引、试探和含蓄暧昧，但不得把暧昧升级成已经确定的现实恋爱、婚姻、同居或身体接触。`;
  }
  if (profile.currentMode === "intimate") {
    return `【结构化当前模式：亲密档案｜用户已在界面明确开启】\n${relationship}\n以下内容只在本次亲密模式中作为演出偏好，不是现实事实，退出模式后不得当作现实记忆：\n${profile.intimacyProfile.trim() || "用户尚未填写亲密档案。不要擅自补写偏好或推进露骨情节；先询问边界。"}`;
  }
  if (profile.currentMode === "scenario") {
    return `【结构化当前模式：虚构情境｜用户已在界面明确开启】\n${relationship}\n这是与现实隔离的角色演出。情境中的身份、地点、身体动作和事件均不得写回现实事实。\n情境前提：\n${profile.scenarioProfile.trim() || "尚未登记固定情境；先让用户给出本次场景，不要自行假定已同处。"}`;
  }
  return `【结构化当前模式：现实聊天】\n${relationship}\n亲密档案与虚构情境当前未加载。人物卡或世界书里的共感、里世界、婚恋和身体描写不得覆盖此状态。`;
}
