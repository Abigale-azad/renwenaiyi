"use client";

import { useState } from "react";
import { addChatContact, createOrGetSession } from "@/lib/chat-storage";
import { createCharacter, loadCharacters, saveCharacters } from "@/lib/character-storage";
import { moveCharacterToWorld, type CharacterWorldGroup } from "@/lib/character-world-storage";
import { CASTING_SECTION_LABELS, DEFAULT_AUDITION_PROMPT, DEFAULT_CASTING_PROMPT, composePersona, generateCastingCandidates, loadAuditionPrompt, loadCastingPrompt, saveAuditionPrompt, saveCastingPrompt, type CastingCandidate, type CastingProfile, type CastingSections } from "@/lib/casting-studio";
import { ChevronLeft, FileText, Loader2, Pencil, RefreshCw, Settings2, Sparkles, UserPlus, X } from "lucide-react";
import { kvSet } from "@/lib/kv-db";

const initialProfile: CastingProfile = { identity: "", internetPersona: "", temperament: "", contrast: "", tension: "", controlStyle: "", extra: "" };
const presets = {
  internetPersona: ["技术社区嘴硬派", "贴吧抽象乐子人", "豆瓣文艺毒舌", "游戏圈战术指挥", "金融圈冷面实干派"],
  temperament: ["清冷克制", "傲慢锋利", "阳光话痨", "温柔腹黑", "偏执理性"],
  contrast: ["生活笨蛋", "小动物软肋", "嘴硬纯情", "吃醋会结巴", "精英外表下的幼稚胜负欲"],
  tension: ["高位掌控与克制失控", "低位乞怜但保留自尊", "斯文败类式危险感", "纯情身体反差", "Switch拉扯"],
  controlStyle: ["Dom", "Sub", "Switch", "随机分化"],
};
type View = "setup" | "cards" | "archive" | "scripts" | "prompts";

export function CastingStudio({ worldGroups, initialWorldId, onClose, onSaved, onNotice }: { worldGroups: CharacterWorldGroup[]; initialWorldId: string; onClose: () => void; onSaved: () => void; onNotice: (text: string) => void }) {
  const [view, setView] = useState<View>("setup");
  const [profile, setProfile] = useState(initialProfile);
  const [creativePrompt, setCreativePrompt] = useState(() => loadCastingPrompt());
  const [auditionPrompt, setAuditionPrompt] = useState(() => loadAuditionPrompt());
  const [candidates, setCandidates] = useState<CastingCandidate[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [addContact, setAddContact] = useState(true);
  const [worldId, setWorldId] = useState(initialWorldId);
  const candidate = candidates[active];
  const update = (key: keyof CastingProfile, value: string) => setProfile((current) => ({ ...current, [key]: value }));

  const generate = async () => {
    setBusy(true);
    try { const next = await generateCastingCandidates(profile, creativePrompt, auditionPrompt); if (!next.length) throw new Error("没有生成有效人物卡，请重试。"); setCandidates(next); setActive(0); setView("cards"); }
    catch (error) { onNotice(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { setBusy(false); }
  };
  const patchCandidate = (patch: Partial<CastingCandidate>) => setCandidates((items) => items.map((item, index) => index === active ? { ...item, ...patch } : item));
  const patchSection = (key: keyof CastingSections, value: string) => {
    if (!candidate) return;
    const sections = { ...candidate.sections, [key]: value };
    patchCandidate({ sections, persona: composePersona(sections) });
  };
  const patchScript = (index: number, message: string) => candidate && patchCandidate({ auditionPrompts: candidate.auditionPrompts.map((item, i) => i === index ? { ...item, message } : item) });
  const materialize = (forceContact = addContact) => {
    if (!candidate) return null;
    const all = loadCharacters();
    const char = createCharacter({ name: candidate.name, avatar: null, persona: composePersona(candidate.sections), personality: candidate.personality, briefPersona: candidate.briefPersona, briefPersonaUpdatedAt: new Date().toISOString(), tags: ["妃卡", ...candidate.keywords] });
    char.canvasX = 180 + Math.random() * 100; char.canvasY = 160 + Math.random() * 120; char.canvasRot = Math.round(Math.random() * 8 - 4); char.canvasZIndex = Math.max(100, ...all.map((item) => item.canvasZIndex || 0)) + 1;
    saveCharacters([...all, char]); moveCharacterToWorld(char.id, worldId); if (forceContact) addChatContact(char.id);
    onSaved();
    return char;
  };
  const save = () => {
    const char = materialize(); if (!char) return;
    onNotice(`「${char.name}」已保存为正式人物卡${addContact ? "并加入通讯录" : ""}`); onClose();
  };
  const startAudition = () => {
    if (!candidate || candidate.auditionPrompts.length === 0) return;
    const char = materialize(true); if (!char) return;
    const session = createOrGetSession(char.id);
    const scripts = candidate.auditionPrompts.map(({ title, message }) => ({ title, message })).filter(item => item.message.trim());
    kvSet(`ai_phone_auto_audition_${session.id}`, JSON.stringify(scripts));
    onNotice(`已保存「${char.name}」，正在进入微信自动试戏`);
    onClose();
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: session.id } }));
  };

  return <div className="fixed inset-0 z-[10040] bg-[#0d0d0f] text-[#f3f1ed] overflow-y-auto" role="dialog" aria-modal="true" aria-label="妃卡">
    <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-4 bg-[#0d0d0f]/95 border-b border-white/10">
      <button className="w-10 h-10 flex items-center justify-center" onClick={view === "setup" ? onClose : () => setView(view === "prompts" ? "setup" : "cards")} aria-label="返回">{view === "setup" ? <X size={20}/> : <ChevronLeft size={21}/>}</button>
      <div className="text-center"><div className="text-[10px] tracking-[.25em] text-[#b69b73]">CONSORT CARD</div><h2 className="text-lg font-semibold">{view === "prompts" ? "提示词设置" : view === "archive" ? "完整人物卡" : view === "scripts" ? "专属试戏剧本" : "妃卡"}</h2></div>
      <button className="w-10 h-10 flex items-center justify-center" onClick={() => setView("prompts")} aria-label="提示词设置"><Settings2 size={19}/></button>
    </header>
    <main className="p-4 pb-14 max-w-xl mx-auto">
      {view === "prompts" && <PromptSettings creative={creativePrompt} audition={auditionPrompt} onCreative={setCreativePrompt} onAudition={setAuditionPrompt} onSave={() => { saveCastingPrompt(creativePrompt); saveAuditionPrompt(auditionPrompt); onNotice("妃卡提示词已保存"); setView(candidates.length ? "cards" : "setup"); }} onReset={() => { setCreativePrompt(DEFAULT_CASTING_PROMPT); setAuditionPrompt(DEFAULT_AUDITION_PROMPT); }}/>} 
      {view === "setup" && <><p className="text-sm text-white/55 mb-5">AI 自动填写三张与方承意、凝凝相同结构的人物卡草稿。确认前不会进入人物、通讯录或世界书。</p><div className="space-y-5">
        <Field label="现实身份" value={profile.identity} onChange={(v)=>update("identity",v)} placeholder="古籍修复师 / 计算机男大 / 投行经理"/>
        <Choice label="互联网人格" values={presets.internetPersona} value={profile.internetPersona} onChange={(v)=>update("internetPersona",v)}/><Choice label="性格底色" values={presets.temperament} value={profile.temperament} onChange={(v)=>update("temperament",v)}/><Choice label="萌点 / 反差" values={presets.contrast} value={profile.contrast} onChange={(v)=>update("contrast",v)}/><Choice label="骚点 / 性张力" values={presets.tension} value={profile.tension} onChange={(v)=>update("tension",v)}/><Choice label="控制倾向" values={presets.controlStyle} value={profile.controlStyle} onChange={(v)=>update("controlStyle",v)}/>
        <Field label="额外要求" value={profile.extra} onChange={(v)=>update("extra",v)} placeholder="年龄、穿衣、行业、雷区、关系边界……" multiline/>
        <label className="block text-sm text-white/72"><span>保存到世界观 / 卷宗</span><select className="w-full mt-2 rounded-xl bg-[#19191c] border border-white/10 px-3 py-3" value={worldId} onChange={(e)=>setWorldId(e.target.value)}>{worldGroups.map((world)=><option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
      </div><button className="mt-7 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold flex items-center justify-center gap-2 disabled:opacity-50" onClick={generate} disabled={busy}>{busy?<Loader2 className="animate-spin" size={18}/>:<Sparkles size={18}/>} {busy?"正在生成三张人物卡…":"生成三张妃卡"}</button></>}
      {view === "cards" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><section className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#222126] to-[#151518] p-6 min-h-80 flex flex-col justify-end"><div className="text-xs text-[#b69b73]">{candidate.identity}</div><h3 className="text-3xl font-semibold mt-1">{candidate.name}</h3><div className="flex flex-wrap gap-1.5 my-3">{candidate.keywords.map((word)=><span key={word} className="px-2 py-1 rounded-full bg-white/8 text-xs text-white/65">{word}</span>)}</div><blockquote className="border-l-2 border-[#c6a778] pl-3 text-[15px] leading-7 text-[#f2e6d5]">{candidate.soulLine}</blockquote></section>
        <section className="mt-4 rounded-xl bg-[#18181b] border border-white/10 p-4"><div className="grid grid-cols-6 gap-1 text-center text-[10px]">{[["活人",candidate.audit.vitality],["边界",candidate.audit.boundaries],["辨识",candidate.audit.voice],["反差",candidate.audit.contrast],["张力",candidate.audit.tension],["OOC",candidate.audit.oocRisk]].map(([label,score])=><div key={String(label)}><div className="text-lg text-[#d4b98d]">{score}</div><div className="text-white/45">{label}</div></div>)}</div><p className="mt-3 text-sm text-white/55">{candidate.audit.note}</p></section>
        <div className="grid grid-cols-2 gap-3 mt-4"><button className="h-11 rounded-xl border border-white/15 flex items-center justify-center gap-2" onClick={()=>setView("archive")}><FileText size={16}/>查看人物卡</button><button className="h-11 rounded-xl border border-white/15 flex items-center justify-center gap-2" onClick={()=>setView("scripts")}><Pencil size={16}/>试戏剧本</button></div>
        <label className="mt-5 flex items-center gap-3 text-sm text-white/70"><input type="checkbox" checked={addContact} onChange={(e)=>setAddContact(e.target.checked)} className="accent-[#c6a778]"/>保存后同时加入通讯录</label><button className="mt-3 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold flex items-center justify-center gap-2" onClick={save}><UserPlus size={17}/>保存为正式人物</button><button className="mt-3 w-full h-10 text-sm text-white/45 flex items-center justify-center gap-2" onClick={()=>{setCandidates([]);setView("setup");}}><RefreshCw size={14}/>调整条件重新生成</button>
      </>}
      {view === "archive" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><div className="space-y-3">{CASTING_SECTION_LABELS.map(([key,label])=><details key={key} className="rounded-xl bg-[#18181b] border border-white/10" open={key === "basic" || key === "core"}><summary className="p-4 cursor-pointer font-medium">{label}</summary><textarea className="w-full min-h-36 bg-transparent border-t border-white/8 p-4 text-sm leading-6 outline-none" value={candidate.sections[key]} onChange={(e)=>patchSection(key,e.target.value)}/></details>)}</div><button className="mt-5 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={save}>保存为正式人物</button></>}
      {view === "scripts" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><p className="text-sm text-white/55 mb-4">每个人都有独立随机剧本。这里可以直接改；内容尚未写入你的正式聊天。</p><div className="space-y-3">{candidate.auditionPrompts.map((script,index)=><label key={script.id} className="block rounded-xl bg-[#18181b] border border-white/10 p-4"><span className="text-xs text-[#c6a778]">{script.title}</span><textarea className="w-full min-h-24 mt-2 bg-transparent text-sm leading-6 outline-none" value={script.message} onChange={(e)=>patchScript(index,e.target.value)}/></label>)}</div><div className="mt-5 rounded-xl border border-[#c6a778]/30 bg-[#c6a778]/8 p-4 text-sm text-white/65">点击后先按现有格式保存人物并加入通讯录，再进入真正的微信聊天。系统会逐条发送这套剧本并等待模型真实回复，不是预制气泡。</div><button className="mt-4 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={startAudition}>保存人物并自动试戏</button></>}
    </main>
  </div>;
}

function CandidateTabs({candidates,active,onSelect}:{candidates:CastingCandidate[];active:number;onSelect:(i:number)=>void}) { return <div className="flex gap-2 mb-4">{candidates.map((item,index)=><button key={`${item.name}-${index}`} className={`flex-1 py-2 rounded-lg text-sm border truncate ${active===index?"border-[#c6a778] bg-[#c6a778]/15 text-[#e8c998]":"border-white/10 text-white/55"}`} onClick={()=>onSelect(index)}>{item.name}</button>)}</div> }
function PromptSettings({creative,audition,onCreative,onAudition,onSave,onReset}:{creative:string;audition:string;onCreative:(v:string)=>void;onAudition:(v:string)=>void;onSave:()=>void;onReset:()=>void}) { return <><p className="text-sm text-white/55 mb-5">这里只修改妃卡的创作和出题规则，不会改变方承意、凝凝或已有世界书。</p><Field label="角色生成提示词" value={creative} onChange={onCreative} placeholder="角色创作总纲" multiline/><div className="h-5"/><Field label="试戏出题提示词" value={audition} onChange={onAudition} placeholder="随机试戏问题规则" multiline/><div className="grid grid-cols-2 gap-3 mt-5"><button className="h-11 rounded-xl border border-white/15" onClick={onReset}>恢复默认</button><button className="h-11 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={onSave}>保存提示词</button></div></> }
function Field({label,value,onChange,placeholder,multiline=false}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string;multiline?:boolean}) { const cls="w-full mt-2 rounded-xl bg-white/6 border border-white/10 px-3 py-3 text-sm outline-none focus:border-[#c6a778] placeholder:text-white/25"; return <label className="block text-sm text-white/72"><span>{label}</span>{multiline?<textarea className={`${cls} min-h-32`} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder}/>:<input className={cls} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder}/>}</label> }
function Choice({label,values,value,onChange}:{label:string;values:string[];value:string;onChange:(v:string)=>void}) { return <div><div className="text-sm text-white/72 mb-2">{label}</div><div className="flex flex-wrap gap-2">{values.map((item)=><button type="button" key={item} className={`px-3 py-2 rounded-full text-xs border ${value===item?"border-[#c6a778] bg-[#c6a778]/15 text-[#e8c998]":"border-white/10 text-white/55"}`} onClick={()=>onChange(value===item?"":item)}>{item}</button>)}</div></div> }
