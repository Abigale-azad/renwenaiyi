"use client";
import { useState } from "react";
import { applyCharacterMemoryAudit, auditCharacterMemories, type MemoryAuditAction, type MemoryAuditItem } from "@/lib/character-memory-audit";

export function CharacterMemoryAudit({ characterId, onApplied }: { characterId: string; onApplied?: () => void }) {
  const [items, setItems] = useState<MemoryAuditItem[]>([]); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const run = async () => { setBusy(true); setNotice("正在检查旧记忆，只生成预览…"); try { const next = await auditCharacterMemories(characterId); setItems(next); setNotice(next.length ? `已检查 ${next.length} 条，请逐条确认` : "暂无可体检记忆"); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); try { await applyCharacterMemoryAudit(characterId, items); setNotice("已按预览迁移；原文未删除，停用项仍可在档案中查看"); setItems([]); onApplied?.(); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const change = (id: string, action: MemoryAuditAction) => setItems(current => current.map(item => item.id === id ? { ...item, action } : item));
  return <section className="memory-audit"><div className="memory-audit-head"><div><b>旧记忆体检</b><small>识别亲密演出、串角色与虚构事实；确认前绝不修改。</small></div><button disabled={busy} onClick={() => void run()}>{busy ? "检查中…" : "开始体检"}</button></div>{notice && <p className="memory-audit-notice">{notice}</p>}{items.map(item => <article key={item.id}><p>{item.content}</p><small>{item.reason}</small><select value={item.action} onChange={event => change(item.id, event.target.value as MemoryAuditAction)}><option value="reality">保留为日常</option><option value="intimate">移入亲密</option><option value="disable">停用污染记忆</option></select></article>)}{items.length > 0 && <button className="memory-audit-apply" disabled={busy} onClick={() => void apply()}>确认并执行迁移</button>}</section>;
}
