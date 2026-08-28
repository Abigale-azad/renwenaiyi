import { simpleLLMCall } from "./api-helpers";
import { kvGet, kvSet } from "./kv-db";
import { loadApiConfigs } from "./settings-storage";

const CASTING_PROMPT_KEY = "ai_phone_consort_card_prompt_v1";
const AUDITION_PROMPT_KEY = "ai_phone_consort_audition_prompt_v1";
const CASTING_BATCH_KEY = "ai_phone_consort_last_batch_v2";

export const DEFAULT_CASTING_PROMPT = `你是“妃卡”的角色总编剧。请创造有独立人格、真实生活轨迹和稳定价值观的成年男性角色。

角色不能围着用户转，也不能把每个话题强行拐向恋爱。互联网人格必须真正影响他的词汇、信息来源、幽默、争论方式和朋友圈。日常状态清爽有分寸；严肃讨论优先解决问题；私密模式只能由明确语境触发。性张力必须与核心性格同源，禁止全天发情、油腻强迫、客服腔、总结腔和无脑迎合。

人物卡必须完整书写：基本信息、身份与现实生活、核心性格、个人特质、互联网人格、日常对话模式、私密模式与触发、萌点与反差、骚点与性张力、骚话与私密语言、角色的世界认知与立场、视觉与社交呈现、关系定位与边界、OOC禁令。骚话模块要写清触发器、称呼词汇、句长标点、禁用表达，以及轻度试探、暧昧升温、明确私密触发、失控、回归日常五级示例；示例只作风格参考，禁止机械复读。`;
export const DEFAULT_AUDITION_PROMPT = `为每位候选随机生成一套只属于他的试戏问题，覆盖日常生活、严肃讨论、分歧与边界、明确私密触发。每条 message 只能是“用户发给候选人”的聊天消息，sender 必须为 user；严禁代写候选人的回答、动作、内心或以“角色：”开头。问题要结合候选的现实身份、知识领域、互联网人格和弱点，不能三个人换名字复用。`;

export type CastingProfile = { identity: string; internetPersona: string; temperament: string; contrast: string; tension: string; controlStyle: string; worldContext: string; relationshipPremise: string; styleDirective: string; extra: string };
export type CastingSections = { basic: string; life: string; core: string; traits: string; internet: string; daily: string; privateMode: string; cute: string; tension: string; spicyLanguage: string; worldview: string; social: string; relationship: string; ooc: string };
export type AuditionPrompt = { id: string; title: string; message: string; sender: "user"; purpose: string };
export type CandidateStatus = "pending" | "auditioning" | "saved" | "rejected";
export type CastingCandidate = { draftId: string; status: CandidateStatus; savedCharacterId?: string; name: string; soulLine: string; identity: string; keywords: string[]; sections: CastingSections; persona: string; personality: string; briefPersona: string; auditionPrompts: AuditionPrompt[]; audit: { vitality: number; boundaries: number; voice: number; contrast: number; tension: number; oocRisk: number; note: string } };
export type CastingBatch = { id: string; createdAt: number; profile: CastingProfile; candidates: CastingCandidate[]; worldId: string; worldBookIds: string[]; bindWorldBooks: boolean; newWorldName?: string };

export const CASTING_SECTION_LABELS: Array<[keyof CastingSections, string]> = [
  ["basic", "基本信息"], ["life", "身份与现实生活"], ["core", "核心性格"], ["traits", "个人特质"], ["internet", "互联网人格"], ["daily", "日常对话模式"], ["privateMode", "私密模式与触发"], ["cute", "萌点与反差"], ["tension", "骚点与性张力"], ["spicyLanguage", "骚话与私密语言"], ["worldview", "角色的世界认知与立场"], ["social", "视觉与社交呈现"], ["relationship", "关系定位与边界"], ["ooc", "OOC禁令"],
];
export function loadCastingPrompt(): string { return kvGet(CASTING_PROMPT_KEY) || DEFAULT_CASTING_PROMPT; }
export function saveCastingPrompt(value: string): void { kvSet(CASTING_PROMPT_KEY, value.trim() || DEFAULT_CASTING_PROMPT); }
export function loadAuditionPrompt(): string { return kvGet(AUDITION_PROMPT_KEY) || DEFAULT_AUDITION_PROMPT; }
export function saveAuditionPrompt(value: string): void { kvSet(AUDITION_PROMPT_KEY, value.trim() || DEFAULT_AUDITION_PROMPT); }
export function loadCastingBatch(): CastingBatch | null { try { const raw = kvGet(CASTING_BATCH_KEY); return raw ? JSON.parse(raw) as CastingBatch : null; } catch { return null; } }
export function saveCastingBatch(batch: CastingBatch): void { kvSet(CASTING_BATCH_KEY, JSON.stringify(batch)); }
export function composePersona(sections: CastingSections): string { return CASTING_SECTION_LABELS.map(([key, label]) => `【${label}】\n${sections[key]?.trim() || "（暂无）"}`).join("\n\n"); }

function cleanJson(text: string): string { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const raw = (fenced || text).trim(); const start = raw.indexOf("["); const end = raw.lastIndexOf("]"); return start >= 0 && end > start ? raw.slice(start, end + 1) : raw; }
function clampScore(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50; }
function stringSections(raw: unknown): CastingSections { const value = (raw && typeof raw === "object" ? raw : {}) as Partial<CastingSections>; return Object.fromEntries(CASTING_SECTION_LABELS.map(([key]) => [key, String(value[key] || "")])) as CastingSections; }
function sanitizeUserAudition(message: string): string { return message.trim().replace(/^(?:角色|候选|男主|他|assistant|助手)\s*[：:]\s*/i, "").replace(/^“|”$/g, ""); }

export async function generateCastingCandidates(profile: CastingProfile, creativePrompt = loadCastingPrompt(), auditionPrompt = loadAuditionPrompt()): Promise<CastingCandidate[]> {
  const apiConfig = loadApiConfigs().find((item) => item.apiKey?.trim() && item.defaultModel?.trim());
  if (!apiConfig) throw new Error("还没有可用的 API 配置，请先在设置里配置模型。");
  const prompt = `${creativePrompt}\n\n【本轮生成上下文｜最高优先级】\n世界观与已选世界书资料：${profile.worldContext || "现代现实世界"}\n关系前提：${profile.relationshipPremise || "尚未确定关系，不默认热恋"}\n文风、尺度与张力：${profile.styleDirective || "鲜明、具体、拒绝模板化"}\n\n【人物偏好】\n现实身份：${profile.identity || "随机但真实"}\n互联网人格：${profile.internetPersona || "随机具体中文互联网轨迹"}\n性格底色：${profile.temperament || "随机且鲜明"}\n萌点：${profile.contrast || "具体生活弱点"}\n骚点/性张力：${profile.tension || "强且与人格绑定"}\n控制倾向：${profile.controlStyle || "随机分化"}\n补充：${profile.extra || "无"}\n\n【试戏规则】\n${auditionPrompt}\n\n生成3位差异显著候选，只输出JSON数组。格式：\n[{"name":"","soulLine":"","identity":"","keywords":["","",""],"personality":"","briefPersona":"","sections":{"basic":"","life":"","core":"","traits":"","internet":"","daily":"","privateMode":"","cute":"","tension":"","spicyLanguage":"","worldview":"","social":"","relationship":"","ooc":""},"auditionPrompts":[{"title":"日常生活","sender":"user","purpose":"测试日常活人感","message":""},{"title":"严肃讨论","sender":"user","purpose":"测试知识与公私分明","message":""},{"title":"分歧与边界","sender":"user","purpose":"测试边界和反应","message":""},{"title":"私密触发","sender":"user","purpose":"测试私密语言开关","message":""}],"audit":{"vitality":0,"boundaries":0,"voice":0,"contrast":0,"tension":0,"oocRisk":0,"note":""}}]`;
  const result = await simpleLLMCall(apiConfig, [{ role: "system", content: "只输出有效JSON，不得省略字段。所有角色均为成年人。" }, { role: "user", content: prompt }], { temperature: 1, max_tokens: 16000 });
  if (result.error || !result.content) throw new Error(result.error || "模型没有返回候选人物卡。");
  let parsed: unknown; try { parsed = JSON.parse(cleanJson(result.content)); } catch { throw new Error("人物卡解析失败，请重试一次。"); }
  if (!Array.isArray(parsed)) throw new Error("模型返回格式不正确，请重试。");
  return parsed.slice(0, 3).map((raw, candidateIndex) => {
    const item = raw as Partial<CastingCandidate>; const sections = stringSections(item.sections); const audit = item.audit || {} as CastingCandidate["audit"];
    const auditionPrompts = Array.isArray(item.auditionPrompts) ? item.auditionPrompts.slice(0, 8).map((p, i) => ({ id: `aud_${candidateIndex}_${i}_${Date.now()}`, title: String(p?.title || `场景${i + 1}`), sender: "user" as const, purpose: String(p?.purpose || "测试人物反应"), message: sanitizeUserAudition(String(p?.message || "")) })) : [];
    return { draftId: `candidate_${Date.now()}_${candidateIndex}`, status: "pending" as const, name: String(item.name || "未命名候选"), soulLine: String(item.soulLine || ""), identity: String(item.identity || ""), keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 5).map(String) : [], sections, persona: composePersona(sections), personality: String(item.personality || ""), briefPersona: String(item.briefPersona || ""), auditionPrompts, audit: { vitality: clampScore(audit.vitality), boundaries: clampScore(audit.boundaries), voice: clampScore(audit.voice), contrast: clampScore(audit.contrast), tension: clampScore(audit.tension), oocRisk: clampScore(audit.oocRisk), note: String(audit.note || "") } };
  }).filter((item) => item.name && item.persona);
}

export async function generateInspirationTags(profile: CastingProfile, rejected: string[] = []): Promise<Record<string, string[]>> {
  const apiConfig = loadApiConfigs().find((item) => item.apiKey?.trim() && item.defaultModel?.trim());
  if (!apiConfig) throw new Error("还没有可用的 API 配置。");
  const prompt = `基于以下世界和关系，为成年男性角色生成新鲜、具体、有中文互联网生活感的灵感标签。避免空泛词，避开已看过：${rejected.join("、") || "无"}。\n世界：${profile.worldContext}\n关系：${profile.relationshipPremise}\n只输出JSON对象，每项5个短标签：internetPersona,temperament,defense,cute,weakness,relationship,tension,controlStyle,spicyLanguage。`;
  const result = await simpleLLMCall(apiConfig, [{ role: "system", content: "只输出有效JSON。" }, { role: "user", content: prompt }], { temperature: 1.15, max_tokens: 2500 });
  if (result.error || !result.content) throw new Error(result.error || "灵感生成失败。");
  const parsed = JSON.parse(result.content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || result.content) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 6).map(String) : []]));
}

export async function generateSpicySamples(candidate: CastingCandidate, count = 5, avoid: string[] = []): Promise<string[]> {
  const apiConfig = loadApiConfigs().find((item) => item.apiKey?.trim() && item.defaultModel?.trim());
  if (!apiConfig) throw new Error("还没有可用的 API 配置。");
  const prompt = `根据人物卡生成${count}条“骚话与私密语言”试听。角色均为成年人。必须保持人物口吻和关系边界，按轻度试探、暧昧升温、明确私密触发、失控、回归日常分级；这是风格样本，不得套话。避开：${avoid.join("｜") || "无"}\n人物：${candidate.name}\n${composePersona(candidate.sections)}\n只输出JSON字符串数组。`;
  const result = await simpleLLMCall(apiConfig, [{ role: "system", content: "只输出有效JSON数组。" }, { role: "user", content: prompt }], { temperature: 1.1, max_tokens: 2500 });
  if (result.error || !result.content) throw new Error(result.error || "试听生成失败。");
  const raw = result.content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || result.content;
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.slice(0, count).map(String) : [];
}
