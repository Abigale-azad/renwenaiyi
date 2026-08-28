"use client";

import { useState } from "react";
import { addChatContact, createOrGetSession } from "@/lib/chat-storage";
import { createCharacter, loadCharacters, saveCharacters } from "@/lib/character-storage";
import { createCharacterWorldGroup, moveCharacterToWorld, updateCharacterWorldDescription, type CharacterWorldGroup } from "@/lib/character-world-storage";
import { CASTING_SECTION_LABELS, DEFAULT_AUDITION_PROMPT, DEFAULT_CASTING_PROMPT, composePersona, generateCastingCandidates, generateInspirationTags, generateSpicySamples, loadAuditionPrompt, loadCastingBatch, loadCastingPrompt, saveAuditionPrompt, saveCastingBatch, saveCastingPrompt, type CastingBatch, type CastingCandidate, type CastingProfile, type CastingSections } from "@/lib/casting-studio";
import { ChevronLeft, FileText, Loader2, Pencil, RefreshCw, Settings2, Sparkles, UserPlus, X } from "lucide-react";
import { kvSet } from "@/lib/kv-db";
import { getCharacterBinding, loadBindingConfig, loadWorldBooks, saveBindingConfig, setCharacterBinding } from "@/lib/settings-storage";

const initialProfile: CastingProfile = {
  identity: "", internetPersona: "", temperament: "", contrast: "", tension: "", controlStyle: "",
  worldContext: "现代现实世界。角色拥有独立的学习、工作、社交与信息来源；除非设定明确，不共享用户未告知的信息。",
  relationshipPremise: "角色与用户尚未被默认写成热恋关系。允许真实试探、克制、冲突、拒绝和逐渐建立的偏爱。",
  styleDirective: "表达可以鲜明、极端、有攻击性或欲望张力，但必须与人格同源。用具体动作、停顿、选择和语言习惯制造张力，拒绝空泛唯美、客服口吻、模板化霸总与无脑臣服。",
  extra: "",
};
type View = "setup" | "cards" | "archive" | "scripts" | "prompts";
const tagLabels: Record<string,string> = { internetPersona:"互联网人格", temperament:"核心性格", defense:"防御机制", cute:"萌点", weakness:"生活弱点", relationship:"关系张力", tension:"骚点", controlStyle:"控制倾向", spicyLanguage:"骚话语言" };

export function CastingStudio({ worldGroups, initialWorldId, onClose, onSaved, onNotice }: { worldGroups: CharacterWorldGroup[]; initialWorldId: string; onClose: () => void; onSaved: () => void; onNotice: (text: string) => void }) {
  const restored = loadCastingBatch();
  const [view, setView] = useState<View>("setup");
  const [profile, setProfile] = useState(restored?.profile || initialProfile);
  const [creativePrompt, setCreativePrompt] = useState(() => loadCastingPrompt());
  const [auditionPrompt, setAuditionPrompt] = useState(() => loadAuditionPrompt());
  const [candidates, setCandidates] = useState<CastingCandidate[]>(restored?.candidates || []);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [addContact, setAddContact] = useState(true);
  const [worldId, setWorldId] = useState(restored?.worldId || initialWorldId);
  const [worldBookIds, setWorldBookIds] = useState<string[]>(restored?.worldBookIds || []);
  const [bindWorldBooks, setBindWorldBooks] = useState(restored?.bindWorldBooks ?? true);
  const [newWorldName, setNewWorldName] = useState(restored?.newWorldName || "");
  const [tagIdeas, setTagIdeas] = useState<Record<string, string[]>>({});
  const [seenTags, setSeenTags] = useState<string[]>([]);
  const [spicySamples, setSpicySamples] = useState<Record<string,string[]>>({});
  const worldBooks = loadWorldBooks();
  const candidate = candidates[active];
  const update = (key: keyof CastingProfile, value: string) => setProfile((current) => ({ ...current, [key]: value }));

  const generate = async () => {
    setBusy(true);
    try { const group = worldGroups.find(item=>item.id===worldId); const selectedBooks = worldBooks.filter(book=>worldBookIds.includes(book.id)); const source = [profile.worldContext, group?.description ? `【已有公共世界：${group.name}】\n${group.description}` : "", ...selectedBooks.map(book=>`【世界书：${book.name}】\n${book.entries.filter(entry=>!entry.disable).map(entry=>entry.content).join("\n")}`)].filter(Boolean).join("\n\n"); const generationProfile = { ...profile, worldContext: source }; const next = await generateCastingCandidates(generationProfile, creativePrompt, auditionPrompt); if (!next.length) throw new Error("没有生成有效人物卡，请重试。"); const batch = makeBatch(next); setCandidates(next); saveCastingBatch(batch); setActive(0); setView("cards"); }
    catch (error) { onNotice(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { setBusy(false); }
  };
  const makeBatch = (items: CastingCandidate[]): CastingBatch => ({ id: restored?.id || `batch_${Date.now()}`, createdAt: restored?.createdAt || Date.now(), profile, candidates: items, worldId, worldBookIds, bindWorldBooks, newWorldName: newWorldName.trim() || undefined });
  const persistCandidates = (updater: (items: CastingCandidate[]) => CastingCandidate[]) => setCandidates((items) => { const next = updater(items); saveCastingBatch(makeBatch(next)); return next; });
  const patchCandidate = (patch: Partial<CastingCandidate>) => persistCandidates((items) => items.map((item, index) => index === active ? { ...item, ...patch } : item));
  const patchSection = (key: keyof CastingSections, value: string) => {
    if (!candidate) return;
    const sections = { ...candidate.sections, [key]: value };
    patchCandidate({ sections, persona: composePersona(sections) });
  };
  const patchScript = (index: number, message: string) => candidate && patchCandidate({ auditionPrompts: candidate.auditionPrompts.map((item, i) => i === index ? { ...item, message } : item) });
  const materialize = (forceContact = addContact) => {
    if (!candidate) return null;
    if (candidate.savedCharacterId) return loadCharacters().find(item => item.id === candidate.savedCharacterId) || null;
    const all = loadCharacters();
    const char = createCharacter({ name: candidate.name, avatar: null, persona: composePersona(candidate.sections), personality: candidate.personality, briefPersona: candidate.briefPersona, briefPersonaUpdatedAt: new Date().toISOString(), tags: ["妃卡", ...candidate.keywords] });
    char.canvasX = 180 + Math.random() * 100; char.canvasY = 160 + Math.random() * 120; char.canvasRot = Math.round(Math.random() * 8 - 4); char.canvasZIndex = Math.max(100, ...all.map((item) => item.canvasZIndex || 0)) + 1;
    saveCharacters([...all, char]);
    let targetWorldId = worldId;
    if (newWorldName.trim()) { const existing = worldGroups.find(item => item.name.trim() === newWorldName.trim()); const group = existing || createCharacterWorldGroup(newWorldName.trim()); targetWorldId = group.id; if (!existing && profile.worldContext.trim()) updateCharacterWorldDescription(group.id, profile.worldContext.trim()); }
    moveCharacterToWorld(char.id, targetWorldId); if (forceContact) addChatContact(char.id);
    if (bindWorldBooks && worldBookIds.length) { const config = loadBindingConfig(); const binding = getCharacterBinding(config, char.id); binding.defaults = { ...binding.defaults, worldBookIds: [...worldBookIds] }; saveBindingConfig(setCharacterBinding(config, binding)); }
    patchCandidate({ status: "saved", savedCharacterId: char.id });
    onSaved();
    return char;
  };
  const save = () => {
    const char = materialize(); if (!char) return;
    onNotice(`「${char.name}」已保存；其余候选仍在本批次中`);
  };
  const startAudition = () => {
    if (!candidate || candidate.auditionPrompts.length === 0) return;
    const char = materialize(true); if (!char) return;
    const session = createOrGetSession(char.id);
    const scripts = candidate.auditionPrompts.filter(item => item.sender === "user").map(({ title, message, purpose }) => ({ title, message, purpose, sender: "user" })).filter(item => item.message.trim());
    kvSet(`ai_phone_auto_audition_${session.id}`, JSON.stringify(scripts));
    patchCandidate({ status: "auditioning", savedCharacterId: char.id }); onNotice(`已保存「${char.name}」，正在进入微信自动试戏`);
    onClose();
    window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: session.id } }));
  };
  const refreshTags = async () => { setBusy(true); try { const ideas = await generateInspirationTags(profile, seenTags); const fresh = Object.values(ideas).flat(); setSeenTags(items => [...items, ...fresh]); setTagIdeas(ideas); } catch (error) { onNotice(error instanceof Error ? error.message : "灵感生成失败"); } finally { setBusy(false); } };
  const chooseIdea = (key: string, value: string) => { const map: Record<string, keyof CastingProfile> = { internetPersona: "internetPersona", temperament: "temperament", cute: "contrast", weakness: "contrast", tension: "tension", controlStyle: "controlStyle", spicyLanguage: "extra", defense: "temperament", relationship: "relationshipPremise" }; const target = map[key]; if (target) update(target, profile[target] === value ? "" : value); };
  const refreshSpicy = async (index?: number) => { if (!candidate) return; setBusy(true); try { const current = spicySamples[candidate.draftId] || []; const fresh = await generateSpicySamples(candidate, index === undefined ? 5 : 1, current); setSpicySamples(all=>({ ...all, [candidate.draftId]: index === undefined ? fresh : current.map((line,i)=>i===index?(fresh[0]||line):line) })); } catch(error) { onNotice(error instanceof Error ? error.message : "试听生成失败"); } finally { setBusy(false); } };
  const saveSpicySamples = () => { if (!candidate) return; const samples = spicySamples[candidate.draftId] || []; patchSection("spicyLanguage", `${candidate.sections.spicyLanguage.trim()}\n\n【可变风格试听样本｜禁止机械复读】\n${samples.map((line,index)=>`${index+1}. ${line}`).join("\n")}`.trim()); onNotice("骚话试听已写入这张人物卡"); };

  return <div className="fixed inset-0 z-[10040] bg-[#0d0d0f] text-[#f3f1ed] overflow-y-auto" role="dialog" aria-modal="true" aria-label="妃卡">
    <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-4 bg-[#0d0d0f]/95 border-b border-white/10">
      <button className="w-10 h-10 flex items-center justify-center" onClick={view === "setup" ? onClose : () => setView(view === "prompts" ? "setup" : "cards")} aria-label="返回">{view === "setup" ? <X size={20}/> : <ChevronLeft size={21}/>}</button>
      <div className="text-center"><div className="text-[10px] tracking-[.25em] text-[#b69b73]">CONSORT CARD</div><h2 className="text-lg font-semibold">{view === "prompts" ? "提示词设置" : view === "archive" ? "完整人物卡" : view === "scripts" ? "专属试戏剧本" : "妃卡"}</h2></div>
      <button className="w-10 h-10 flex items-center justify-center" onClick={() => setView("prompts")} aria-label="提示词设置"><Settings2 size={19}/></button>
    </header>
    <main className="p-4 pb-14 max-w-xl mx-auto">
      {view === "prompts" && <PromptSettings creative={creativePrompt} audition={auditionPrompt} onCreative={setCreativePrompt} onAudition={setAuditionPrompt} onSave={() => { saveCastingPrompt(creativePrompt); saveAuditionPrompt(auditionPrompt); onNotice("妃卡提示词已保存"); setView(candidates.length ? "cards" : "setup"); }} onReset={() => { setCreativePrompt(DEFAULT_CASTING_PROMPT); setAuditionPrompt(DEFAULT_AUDITION_PROMPT); }}/>} 
      {view === "setup" && <><p className="text-sm text-white/55 mb-5">AI 自动填写三张与方承意、凝凝相同结构的人物卡草稿。确认前不会进入人物、通讯录或世界书。</p>{candidates.length > 0 && <button className="mb-5 w-full h-11 rounded-xl border border-[#c6a778]/40 text-[#e8c998]" onClick={()=>setView("cards")}>继续查看上一批候选（{candidates.filter(item=>item.status!=="rejected").length}）</button>}<div className="space-y-5">
        <section className="rounded-2xl border border-[#c6a778]/30 bg-[#c6a778]/7 p-4 space-y-4"><div><div className="text-sm font-semibold text-[#e8c998]">本轮生成上下文</div><p className="text-xs text-white/45 mt-1">在这里注入特殊世界、关系规则和文风尺度；只影响本轮妃卡，不改现有世界书。</p></div>
          <Field label="世界观与情境" value={profile.worldContext} onChange={(v)=>update("worldContext",v)} placeholder="可粘贴完整世界设定、时代背景、特殊规则……" multiline/>
          <Field label="关系与身份前提" value={profile.relationshipPremise} onChange={(v)=>update("relationshipPremise",v)} placeholder="例如秘密关系、旧识重逢、主从契约、敌对拉扯……" multiline/>
          <Field label="文风、尺度与张力指令" value={profile.styleDirective} onChange={(v)=>update("styleDirective",v)} placeholder="告诉模型允许写到什么程度、需要什么语言密度和张力来源……" multiline/>
        </section>
        <Field label="现实身份" value={profile.identity} onChange={(v)=>update("identity",v)} placeholder="古籍修复师 / 计算机男大 / 投行经理"/>
        <section className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="flex items-center justify-between"><div><div className="font-medium">AI 随机灵感</div><p className="text-xs text-white/40 mt-1">没有固定标签；可无限换一批，也可以一个都不选。</p></div><button className="px-3 py-2 rounded-lg border border-white/15 text-xs flex gap-1 items-center" onClick={refreshTags} disabled={busy}><RefreshCw size={13}/>全部换一批</button></div>{Object.entries(tagIdeas).map(([key,values])=><div key={key} className="mt-4"><div className="text-xs text-white/45 mb-2">{tagLabels[key] || key}</div><div className="flex flex-wrap gap-2">{values.map(value=><button key={value} type="button" className="px-3 py-2 rounded-full border border-white/10 text-xs text-white/65" onClick={()=>chooseIdea(key,value)}>{value}</button>)}</div></div>)}</section>
        <Field label="互联网人格（可自由填写）" value={profile.internetPersona} onChange={(v)=>update("internetPersona",v)} placeholder="留空则随机"/>
        <Field label="性格底色" value={profile.temperament} onChange={(v)=>update("temperament",v)} placeholder="留空则随机"/>
        <Field label="萌点 / 生活弱点" value={profile.contrast} onChange={(v)=>update("contrast",v)} placeholder="具体弱点与反差"/>
        <Field label="骚点 / 性张力" value={profile.tension} onChange={(v)=>update("tension",v)} placeholder="张力来源，不等于骚话"/>
        <Field label="控制倾向" value={profile.controlStyle} onChange={(v)=>update("controlStyle",v)} placeholder="可写 Dom / Sub / Switch 或更具体关系"/>
        <Field label="额外要求" value={profile.extra} onChange={(v)=>update("extra",v)} placeholder="年龄、穿衣、行业、雷区、关系边界……" multiline/>
        <label className="block text-sm text-white/72"><span>读取并保存到已有世界</span><select className="w-full mt-2 rounded-xl bg-[#19191c] border border-white/10 px-3 py-3" value={worldId} onChange={(e)=>setWorldId(e.target.value)}>{worldGroups.map((world)=><option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        <Field label="或在正式收下时新建世界（可留空）" value={newWorldName} onChange={setNewWorldName} placeholder="刷新候选时不会创建"/>
        <section><div className="text-sm text-white/72 mb-2">注入已有世界书（可多选）</div><div className="space-y-2 max-h-48 overflow-y-auto">{worldBooks.map(book=><label key={book.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm"><input type="checkbox" className="mt-1 accent-[#c6a778]" checked={worldBookIds.includes(book.id)} onChange={()=>setWorldBookIds(ids=>ids.includes(book.id)?ids.filter(id=>id!==book.id):[...ids,book.id])}/><span><b className="font-medium">{book.name}</b><small className="block text-white/40 mt-1">{book.description || `${book.entries.length} 条设定`}</small></span></label>)}</div>{worldBookIds.length>0&&<label className="flex gap-2 items-center mt-3 text-sm text-white/60"><input type="checkbox" checked={bindWorldBooks} onChange={e=>setBindWorldBooks(e.target.checked)} className="accent-[#c6a778]"/>保存人物后继续绑定这些世界书（关闭则仅生成参考）</label>}</section>
      </div><button className="mt-7 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold flex items-center justify-center gap-2 disabled:opacity-50" onClick={generate} disabled={busy}>{busy?<Loader2 className="animate-spin" size={18}/>:<Sparkles size={18}/>} {busy?"正在生成三张人物卡…":"生成三张妃卡"}</button></>}
      {view === "cards" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><section className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#222126] to-[#151518] p-6 min-h-80 flex flex-col justify-end"><div className="text-xs text-[#b69b73]">{candidate.identity}</div><h3 className="text-3xl font-semibold mt-1">{candidate.name}</h3><div className="flex flex-wrap gap-1.5 my-3">{candidate.keywords.map((word)=><span key={word} className="px-2 py-1 rounded-full bg-white/8 text-xs text-white/65">{word}</span>)}</div><blockquote className="border-l-2 border-[#c6a778] pl-3 text-[15px] leading-7 text-[#f2e6d5]">{candidate.soulLine}</blockquote></section>
        <section className="mt-4 rounded-xl bg-[#18181b] border border-white/10 p-4"><div className="grid grid-cols-6 gap-1 text-center text-[10px]">{[["活人",candidate.audit.vitality],["边界",candidate.audit.boundaries],["辨识",candidate.audit.voice],["反差",candidate.audit.contrast],["张力",candidate.audit.tension],["OOC",candidate.audit.oocRisk]].map(([label,score])=><div key={String(label)}><div className="text-lg text-[#d4b98d]">{score}</div><div className="text-white/45">{label}</div></div>)}</div><p className="mt-3 text-sm text-white/55">{candidate.audit.note}</p></section>
        <div className="grid grid-cols-2 gap-3 mt-4"><button className="h-11 rounded-xl border border-white/15 flex items-center justify-center gap-2" onClick={()=>setView("archive")}><FileText size={16}/>查看人物卡</button><button className="h-11 rounded-xl border border-white/15 flex items-center justify-center gap-2" onClick={()=>setView("scripts")}><Pencil size={16}/>试戏剧本</button></div>
        <label className="mt-5 flex items-center gap-3 text-sm text-white/70"><input type="checkbox" checked={addContact} onChange={(e)=>setAddContact(e.target.checked)} className="accent-[#c6a778]"/>保存后同时加入通讯录</label><button disabled={Boolean(candidate.savedCharacterId)} className="mt-3 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold flex items-center justify-center gap-2 disabled:opacity-45" onClick={save}><UserPlus size={17}/>{candidate.savedCharacterId?"已保存为正式人物":"保存为正式人物"}</button><button className="mt-2 w-full h-10 text-sm text-red-300/65" onClick={()=>patchCandidate({status:candidate.status==="rejected"?"pending":"rejected"})}>{candidate.status==="rejected"?"恢复这位候选":"淘汰这位候选"}</button><button className="mt-2 w-full h-10 text-sm text-white/45 flex items-center justify-center gap-2" onClick={()=>setView("setup")}><RefreshCw size={14}/>调整条件生成新一批（本批仍保留）</button>
      </>}
      {view === "archive" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><section className="mb-4 rounded-xl border border-[#c6a778]/30 bg-[#c6a778]/7 p-4"><div className="flex justify-between items-center"><div><b className="text-sm">骚话试听台</b><p className="text-xs text-white/40 mt-1">与骚点分开；每句可换、改、删，满意后写入人物卡。</p></div><button className="px-3 py-2 rounded-lg border border-white/15 text-xs" onClick={()=>refreshSpicy()} disabled={busy}>生成一组</button></div><div className="space-y-2 mt-3">{(spicySamples[candidate.draftId]||[]).map((line,index)=><div key={index} className="flex gap-2 items-start"><textarea className="flex-1 min-h-20 rounded-lg bg-black/20 p-2 text-sm" value={line} onChange={e=>setSpicySamples(all=>({...all,[candidate.draftId]:(all[candidate.draftId]||[]).map((v,i)=>i===index?e.target.value:v)}))}/><div className="flex flex-col gap-1"><button className="p-2 text-white/55" onClick={()=>refreshSpicy(index)}><RefreshCw size={14}/></button><button className="p-2 text-red-300/60" onClick={()=>setSpicySamples(all=>({...all,[candidate.draftId]:(all[candidate.draftId]||[]).filter((_,i)=>i!==index)}))}><X size={14}/></button></div></div>)}</div>{(spicySamples[candidate.draftId]||[]).length>0&&<button className="mt-3 w-full h-10 rounded-lg bg-[#c6a778] text-[#15120e] text-sm font-bold" onClick={saveSpicySamples}>保存试听到人物卡</button>}</section><div className="space-y-3">{CASTING_SECTION_LABELS.map(([key,label])=><details key={key} className="rounded-xl bg-[#18181b] border border-white/10" open={key === "basic" || key === "core" || key === "spicyLanguage"}><summary className="p-4 cursor-pointer font-medium">{label}</summary><textarea className="w-full min-h-36 bg-transparent border-t border-white/8 p-4 text-sm leading-6 outline-none" value={candidate.sections[key]} onChange={(e)=>patchSection(key,e.target.value)}/></details>)}</div><button className="mt-5 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={save}>保存为正式人物</button></>}
      {view === "scripts" && candidate && <><CandidateTabs candidates={candidates} active={active} onSelect={setActive}/><p className="text-sm text-white/55 mb-4">每条都是“你将发送给他”的测试消息。系统不会再把候选人的台词冒充成你说的。</p><div className="space-y-3">{candidate.auditionPrompts.map((script,index)=><label key={script.id} className="block rounded-xl bg-[#18181b] border border-white/10 p-4"><span className="text-xs text-[#c6a778]">你将发送 · {script.title}</span><small className="block text-white/35 mt-1">{script.purpose}</small><textarea className="w-full min-h-24 mt-2 bg-transparent text-sm leading-6 outline-none" value={script.message} onChange={(e)=>patchScript(index,e.target.value)}/></label>)}</div><div className="mt-5 rounded-xl border border-[#c6a778]/30 bg-[#c6a778]/8 p-4 text-sm text-white/65">保存为原人物卡并进入真实微信聊天，逐条发送测试消息并等待模型真实回复。</div><button className="mt-4 w-full h-12 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={startAudition}>保存人物并自动试戏</button></>}
    </main>
  </div>;
}

function CandidateTabs({candidates,active,onSelect}:{candidates:CastingCandidate[];active:number;onSelect:(i:number)=>void}) { return <div className="flex gap-2 mb-4">{candidates.map((item,index)=><button key={`${item.name}-${index}`} className={`flex-1 py-2 rounded-lg text-sm border truncate ${active===index?"border-[#c6a778] bg-[#c6a778]/15 text-[#e8c998]":"border-white/10 text-white/55"}`} onClick={()=>onSelect(index)}>{item.name}</button>)}</div> }
function PromptSettings({creative,audition,onCreative,onAudition,onSave,onReset}:{creative:string;audition:string;onCreative:(v:string)=>void;onAudition:(v:string)=>void;onSave:()=>void;onReset:()=>void}) { return <><p className="text-sm text-white/55 mb-5">这里只修改妃卡的创作和出题规则，不会改变方承意、凝凝或已有世界书。</p><Field label="角色生成提示词" value={creative} onChange={onCreative} placeholder="角色创作总纲" multiline/><div className="h-5"/><Field label="试戏出题提示词" value={audition} onChange={onAudition} placeholder="随机试戏问题规则" multiline/><div className="grid grid-cols-2 gap-3 mt-5"><button className="h-11 rounded-xl border border-white/15" onClick={onReset}>恢复默认</button><button className="h-11 rounded-xl bg-[#c6a778] text-[#15120e] font-bold" onClick={onSave}>保存提示词</button></div></> }
function Field({label,value,onChange,placeholder,multiline=false}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string;multiline?:boolean}) { const cls="w-full mt-2 rounded-xl bg-white/6 border border-white/10 px-3 py-3 text-sm outline-none focus:border-[#c6a778] placeholder:text-white/25"; return <label className="block text-sm text-white/72"><span>{label}</span>{multiline?<textarea className={`${cls} min-h-32`} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder}/>:<input className={cls} value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder}/>}</label> }
function Choice({label,values,value,onChange}:{label:string;values:string[];value:string;onChange:(v:string)=>void}) { return <div><div className="text-sm text-white/72 mb-2">{label}</div><div className="flex flex-wrap gap-2">{values.map((item)=><button type="button" key={item} className={`px-3 py-2 rounded-full text-xs border ${value===item?"border-[#c6a778] bg-[#c6a778]/15 text-[#e8c998]":"border-white/10 text-white/55"}`} onClick={()=>onChange(value===item?"":item)}>{item}</button>)}</div></div> }
