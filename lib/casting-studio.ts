import { simpleLLMCall } from "./api-helpers";
import { kvGet, kvSet } from "./kv-db";
import { loadApiConfigs } from "./settings-storage";

const CASTING_PROMPT_KEY = "ai_phone_consort_card_prompt_v1";
const AUDITION_PROMPT_KEY = "ai_phone_consort_audition_prompt_v1";

export const DEFAULT_CASTING_PROMPT = `你是“妃卡”的角色总编剧。请创造有独立人格、真实生活轨迹和稳定价值观的成年男性角色。

角色不能围着用户转，也不能把每个话题强行拐向恋爱。互联网人格必须真正影响他的词汇、信息来源、幽默、争论方式和朋友圈，而不是只贴标签。日常状态清爽有分寸；严肃讨论优先解决问题；私密模式只能由明确语境触发。性张力必须与核心性格同源，禁止全天发情、油腻强迫、客服腔、总结腔和无脑迎合。

人物卡必须按以下部分完整书写：基本信息、身份与现实生活、核心性格、个人特质、互联网人格、日常对话模式、私密模式与触发、萌点与反差、骚点与性张力、视觉与社交呈现、关系定位与边界、OOC禁令。个人特质需要包含描述与行为示例。`;

export const DEFAULT_AUDITION_PROMPT = `为每位候选随机生成一套只属于他的试戏问题。必须覆盖日常生活、严肃讨论、分歧与边界、明确私密触发四类场景。问题要结合候选的现实身份、知识领域、互联网人格和弱点，不能三个人换名字复用同一套题；不得替用户使用突兀的称呼。每条应像真实聊天消息，简短、可直接发送。`;

export type CastingProfile = { identity: string; internetPersona: string; temperament: string; contrast: string; tension: string; controlStyle: string; extra: string };
export type CastingSections = { basic: string; life: string; core: string; traits: string; internet: string; daily: string; privateMode: string; cute: string; tension: string; social: string; relationship: string; ooc: string };
export type AuditionPrompt = { id: string; title: string; message: string };
export type CastingCandidate = {
  name: string; soulLine: string; identity: string; keywords: string[]; sections: CastingSections; persona: string; personality: string; briefPersona: string; auditionPrompts: AuditionPrompt[];
  audit: { vitality: number; boundaries: number; voice: number; contrast: number; tension: number; oocRisk: number; note: string };
};

export const CASTING_SECTION_LABELS: Array<[keyof CastingSections, string]> = [
  ["basic", "基本信息"], ["life", "身份与现实生活"], ["core", "核心性格"], ["traits", "个人特质"], ["internet", "互联网人格"], ["daily", "日常对话模式"], ["privateMode", "私密模式与触发"], ["cute", "萌点与反差"], ["tension", "骚点与性张力"], ["social", "视觉与社交呈现"], ["relationship", "关系定位与边界"], ["ooc", "OOC禁令"],
];

export function loadCastingPrompt(): string { return kvGet(CASTING_PROMPT_KEY) || DEFAULT_CASTING_PROMPT; }
export function saveCastingPrompt(value: string): void { kvSet(CASTING_PROMPT_KEY, value.trim() || DEFAULT_CASTING_PROMPT); }
export function loadAuditionPrompt(): string { return kvGet(AUDITION_PROMPT_KEY) || DEFAULT_AUDITION_PROMPT; }
export function saveAuditionPrompt(value: string): void { kvSet(AUDITION_PROMPT_KEY, value.trim() || DEFAULT_AUDITION_PROMPT); }
export function composePersona(sections: CastingSections): string { return CASTING_SECTION_LABELS.map(([key, label]) => `【${label}】\n${sections[key]?.trim() || "（暂无）"}`).join("\n\n"); }

function cleanJson(text: string): string { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const raw = (fenced || text).trim(); const start = raw.indexOf("["); const end = raw.lastIndexOf("]"); return start >= 0 && end > start ? raw.slice(start, end + 1) : raw; }
function clampScore(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50; }
function stringSections(raw: unknown): CastingSections { const value = (raw && typeof raw === "object" ? raw : {}) as Partial<CastingSections>; return Object.fromEntries(CASTING_SECTION_LABELS.map(([key]) => [key, String(value[key] || "")])) as CastingSections; }

export async function generateCastingCandidates(profile: CastingProfile, creativePrompt = loadCastingPrompt(), auditionPrompt = loadAuditionPrompt()): Promise<CastingCandidate[]> {
  const apiConfig = loadApiConfigs().find((item) => item.apiKey?.trim() && item.defaultModel?.trim());
  if (!apiConfig) throw new Error("还没有可用的 API 配置，请先在设置里配置模型。");
  const prompt = `${creativePrompt}\n\n【本轮偏好】\n现实身份：${profile.identity || "随机但真实可落地"}\n互联网人格：${profile.internetPersona || "随机选择具体中文互联网轨迹"}\n性格底色：${profile.temperament || "随机且鲜明"}\n萌点：${profile.contrast || "具体生活弱点"}\n骚点/性张力：${profile.tension || "强且与核心性格绑定"}\n控制倾向：${profile.controlStyle || "随机分化"}\n补充：${profile.extra || "无"}\n\n【试戏出题规则】\n${auditionPrompt}\n\n生成3位差异显著的候选。只输出JSON数组，不要Markdown。字段严格如下：\n[{"name":"","soulLine":"","identity":"","keywords":["","",""],"personality":"一句核心性格","briefPersona":"100-180字简介","sections":{"basic":"","life":"","core":"","traits":"","internet":"","daily":"","privateMode":"","cute":"","tension":"","social":"","relationship":"","ooc":""},"auditionPrompts":[{"title":"日常生活","message":""},{"title":"严肃讨论","message":""},{"title":"分歧与边界","message":""},{"title":"私密触发","message":""}],"audit":{"vitality":0,"boundaries":0,"voice":0,"contrast":0,"tension":0,"oocRisk":0,"note":""}}]`;
  const result = await simpleLLMCall(apiConfig, [{ role: "system", content: "输出必须是有效JSON。不得省略字段，不得输出解释。" }, { role: "user", content: prompt }], { temperature: 1, max_tokens: 16000 });
  if (result.error || !result.content) throw new Error(result.error || "模型没有返回候选人物卡。");
  let parsed: unknown; try { parsed = JSON.parse(cleanJson(result.content)); } catch { throw new Error("人物卡解析失败，请重试一次。"); }
  if (!Array.isArray(parsed)) throw new Error("模型返回格式不正确，请重试。");
  return parsed.slice(0, 3).map((raw, candidateIndex) => {
    const item = raw as Partial<CastingCandidate>; const sections = stringSections(item.sections); const audit = item.audit || {} as CastingCandidate["audit"];
    const auditionPrompts = Array.isArray(item.auditionPrompts) ? item.auditionPrompts.slice(0, 8).map((p, i) => ({ id: `aud_${candidateIndex}_${i}_${Date.now()}`, title: String(p?.title || `场景${i + 1}`), message: String(p?.message || "") })) : [];
    return { name: String(item.name || "未命名候选"), soulLine: String(item.soulLine || ""), identity: String(item.identity || ""), keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 5).map(String) : [], sections, persona: composePersona(sections), personality: String(item.personality || ""), briefPersona: String(item.briefPersona || ""), auditionPrompts, audit: { vitality: clampScore(audit.vitality), boundaries: clampScore(audit.boundaries), voice: clampScore(audit.voice), contrast: clampScore(audit.contrast), tension: clampScore(audit.tension), oocRisk: clampScore(audit.oocRisk), note: String(audit.note || "") } };
  }).filter((item) => item.name && item.persona);
}
