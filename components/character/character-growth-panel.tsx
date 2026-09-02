"use client";
import { useEffect, useState } from "react";
import type { Character } from "@/lib/character-types";
import { loadCharacterGrowth, decideGrowth, setOtherChatsPermission, type CharacterGrowth, type GrowthRevision } from "@/lib/character-growth-storage";
import { migrateCharacterGrowth, runManualPersonalityGrowth } from "@/lib/personality-growth";
import { PageShell } from "@/components/ui/page-shell";

const labels = { current: "当前成长", pending: "待你确认", history: "成长轨迹", privacy: "信息边界" };
export function CharacterGrowthPanel({ character, onBack }: { character: Character; onBack: () => void }) {
  const [tab, setTab] = useState<keyof typeof labels>("current");
  const [state, setState] = useState<CharacterGrowth>({ revisions: [], allowOtherChats: false });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ revision: GrowthRevision; text: string } | null>(null);
  const [confirmAccess, setConfirmAccess] = useState(false);
  useEffect(() => {
    const refresh = () => { try { setState(loadCharacterGrowth(character.id)); } catch (e) { setNotice(String(e)); } };
    try { migrateCharacterGrowth(character.id); } catch (e) { setNotice(String(e)); }
    refresh();
    window.addEventListener("character-growth-updated", refresh);
    return () => window.removeEventListener("character-growth-updated", refresh);
  }, [character.id]);
  const current = state.revisions.find(r => r.status === "approved");
  const rows = state.revisions.filter(r => tab === "current" ? r.status === "approved" : tab === "pending" ? r.status === "pending" : r.status !== "pending");
  async function generate() {
    setBusy(true); setNotice("正在整理本角色的互动，不会自动修改人物卡…");
    try {
      const result = await runManualPersonalityGrowth({ characterId: character.id, characterName: character.name });
      setNotice(result.success ? "已生成候选，请审阅后采用" : result.error || "整理失败");
      if (result.success) setTab("pending");
    } catch (e) { setNotice(String(e)); } finally { setBusy(false); }
  }
  function decide(revision: GrowthRevision, approved: boolean, text?: string) {
    try { decideGrowth(character.id, revision.id, approved, text); setEditor(null); setNotice(approved ? "已采用，仅本角色单聊生效；旧版本已保留" : "已停用／否决，记录仍保留"); } catch(e) { setNotice(String(e)); }
  }
  return <PageShell title={`${character.name} · 成长`} onBack={onBack}>
    <section className="p-4 space-y-4" style={{ background: "var(--c-page-body-bg, #faf8f5)", color: "var(--c-text, #252323)" }}>
      <p className="text-sm opacity-75">核心人物卡不自动改写。成长先生成候选，经你确认后才用于该角色单聊。旧成长簿保留为迁移备份，不再注入世界书。</p>
      <nav className="flex flex-wrap gap-2" aria-label="成长分类">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} className="rounded-xl border px-3 py-2" style={{ fontWeight: tab === key ? 700 : 400, background: tab === key ? "rgba(140,110,120,.16)" : "transparent" }} onClick={() => { setTab(key as keyof typeof labels); setEditor(null); }}>{label}{key === "pending" ? ` (${state.revisions.filter(r => r.status === "pending").length})` : ""}</button>)}</nav>
      <p role="status" className="text-sm">{notice}</p>
      {tab === "privacy" ? <div className="space-y-4 rounded-2xl border p-4">
        <h3 className="font-semibold">私聊默认互不知情</h3>
        <p>自己的聊天和记忆：按角色读取。其他微信联系人、预览和历史：{state.allowOtherChats ? "已明确授权" : "执行层已禁止"}。</p>
        <p className="text-sm opacity-75">此开关只控制内置查手机工具，不是任意第三方 JS 插件的安全沙箱。全局世界书、你主动转述的内容、已有被污染的记忆仍需检查。关闭权限不会自动删除历史。</p>
        {state.allowOtherChats ? <button className="rounded-xl border p-3" onClick={() => setOtherChatsPermission(character.id, false)}>撤销跨聊天读取权限</button> : <button className="rounded-xl border p-3" onClick={() => setConfirmAccess(true)}>申请开放跨聊天读取</button>}
        {confirmAccess && <div role="alertdialog" aria-label="跨聊天授权确认" className="rounded-xl border p-3 space-y-3"><p>确认允许{character.name}通过内置工具读取其他联系人的名称、消息预览和私聊内容？这是持续授权，可随时撤销。</p><button className="border rounded-lg p-2" onClick={() => { setOtherChatsPermission(character.id, true); setConfirmAccess(false); }}>明确允许</button> <button className="border rounded-lg p-2" onClick={() => setConfirmAccess(false)}>取消</button></div>}
      </div> : <>
        <button type="button" disabled={busy} className="rounded-xl border px-4 py-3 disabled:opacity-50" onClick={() => void generate()}>{busy ? "整理中…" : "整理现有互动为候选（调用总结 API）"}</button>
        {rows.length === 0 && <p className="py-8 opacity-65">{tab === "current" ? "暂无已采用成长。可到“待你确认”审阅旧成长簿，或生成新候选。" : "这里暂时没有记录。"}</p>}
        {rows.map(revision => <article key={revision.id} className="rounded-2xl border p-4 space-y-3">
          <p className="text-sm opacity-70">{new Date(revision.createdAt).toLocaleString()} · {revision.source} · {revision.status === "approved" ? "已采用" : revision.status === "pending" ? "待确认" : revision.status === "rejected" ? "已否决／停用" : "历史版本"}</p>
          <p className="whitespace-pre-wrap break-words">{revision.content}</p>
          <details><summary>查看来源证据</summary><p className="text-sm whitespace-pre-wrap break-words mt-3">{revision.evidence}</p></details>
          <div className="flex gap-3 flex-wrap"><button className="rounded-lg border p-2" onClick={() => setEditor({ revision, text: revision.content })}>{revision.status === "pending" ? "对比并采用" : "编辑／恢复此版本"}</button><button className="rounded-lg border p-2" onClick={() => decide(revision, false)}>{revision.status === "approved" ? "停用成长" : "否决"}</button></div>
          {editor?.revision.id === revision.id && <div className="space-y-3"><details open><summary>当前已采用内容（对比）</summary><p className="whitespace-pre-wrap text-sm">{current?.content || "无"}</p></details><label className="block">待采用完整版本<textarea className="w-full rounded-xl border p-3 mt-2" style={{ background: "var(--c-page-body-bg, #faf8f5)", color: "inherit" }} rows={12} value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })}/></label><button className="border rounded-lg p-2" onClick={() => decide(revision, true, editor.text)}>确认替换当前成长，保留旧版本</button> <button className="border rounded-lg p-2" onClick={() => setEditor(null)}>取消</button></div>}
        </article>)}
      </>}
    </section>
  </PageShell>;
}
