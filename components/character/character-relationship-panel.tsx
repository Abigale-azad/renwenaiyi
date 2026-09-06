"use client";

import { useEffect, useState } from "react";
import type { Character } from "@/lib/character-types";
import { CHAT_MODE_LABELS, loadCharacterRelationship, saveCharacterRelationship, type CharacterRelationshipProfile, type RelationshipStage } from "@/lib/character-relationship-storage";
import { PageShell } from "@/components/ui/page-shell";

const STAGES: Array<{ value: RelationshipStage; label: string; hint: string }> = [
  { value: "new", label: "刚认识", hint: "不预设亲密关系" },
  { value: "familiar", label: "熟悉中", hint: "可以自然关心，但不越级" },
  { value: "ambiguous", label: "暧昧中", hint: "允许试探，不等于恋爱成立" },
  { value: "confirmed_online", label: "已确认线上关系", hint: "只承认线上关系，不虚构现实共同生活" },
  { value: "confirmed_real", label: "已确认现实关系", hint: "仅在你确实确认后选择" },
];

export function CharacterRelationshipPanel({ character, onBack }: { character: Character; onBack: () => void }) {
  const [profile, setProfile] = useState<CharacterRelationshipProfile>(() => loadCharacterRelationship(character.id));
  const [notice, setNotice] = useState("");
  useEffect(() => setProfile(loadCharacterRelationship(character.id)), [character.id]);

  function save() {
    saveCharacterRelationship(character.id, profile);
    setProfile(loadCharacterRelationship(character.id));
    setNotice("已保存。现实关系始终注入；亲密与情境内容只在聊天顶部明确开启后注入。");
  }

  const fieldClass = "mt-2 w-full rounded-xl border p-3 bg-transparent text-inherit";
  return <PageShell title={`${character.name} · 关系与模式`} onBack={onBack}>
    <section className="space-y-5 p-4" style={{ background: "var(--c-page-body-bg, #faf8f5)", color: "var(--c-text, #252323)" }}>
      <div className="rounded-2xl border p-4">
        <h3 className="font-semibold">当前聊天模式</h3>
        <p className="mt-2 text-sm opacity-75">现在是「{CHAT_MODE_LABELS[profile.currentMode]}」。模式在具体聊天顶部切换；这里负责保存长期边界，不靠角色自己猜。</p>
      </div>

      <div className="space-y-4 rounded-2xl border p-4">
        <div><h3 className="font-semibold">现实关系</h3><p className="mt-1 text-sm opacity-70">这是事实层，始终生效。人物卡里的浪漫设定不能自动把现实关系升级。</p></div>
        <label className="block text-sm">关系阶段
          <select className={fieldClass} value={profile.relationshipStage} onChange={e => setProfile({ ...profile, relationshipStage: e.target.value as RelationshipStage })}>
            {STAGES.map(item => <option key={item.value} value={item.value}>{item.label} · {item.hint}</option>)}
          </select>
        </label>
        <label className="block text-sm">明确允许的称呼
          <input className={fieldClass} value={profile.allowedAddresses} onChange={e => setProfile({ ...profile, allowedAddresses: e.target.value })} placeholder="例如：卿卿、妈妈（用逗号分隔）；留空则不默认亲昵称呼" />
        </label>
        <label className="block text-sm">已确认的现实事实
          <textarea className={fieldClass} rows={5} value={profile.confirmedRealityFacts} onChange={e => setProfile({ ...profile, confirmedRealityFacts: e.target.value })} placeholder="只写现实中确实成立、希望角色长期知道的事实。" />
        </label>
        <label className="block text-sm">现实关系边界
          <textarea className={fieldClass} rows={4} value={profile.relationshipBoundaries} onChange={e => setProfile({ ...profile, relationshipBoundaries: e.target.value })} placeholder="例如：不自称老公；不能声称来过我家；完成工作必须有真实产出。" />
        </label>
      </div>

      <div className="space-y-4 rounded-2xl border p-4">
        <div><h3 className="font-semibold">亲密档案</h3><p className="mt-1 text-sm opacity-70">只在你从聊天顶部开启「亲密」后加载。退出后，里面的动作与关系不会变成现实记忆。</p></div>
        <textarea className={fieldClass} rows={12} value={profile.intimacyProfile} onChange={e => setProfile({ ...profile, intimacyProfile: e.target.value })} placeholder="粘贴该角色专属的亲密偏好、开关、边界与退出规则。现有人物卡不会被自动删改。" />
      </div>

      <div className="space-y-4 rounded-2xl border p-4">
        <div><h3 className="font-semibold">情境档案</h3><p className="mt-1 text-sm opacity-70">用于共感、里世界、AU 等虚构演出；只在「情境」模式加载。</p></div>
        <textarea className={fieldClass} rows={8} value={profile.scenarioProfile} onChange={e => setProfile({ ...profile, scenarioProfile: e.target.value })} placeholder="填写固定世界规则；留空时角色必须先问本次场景。" />
      </div>

      {notice && <p role="status" className="rounded-xl border p-3 text-sm">{notice}</p>}
      <button type="button" className="w-full rounded-xl bg-[var(--c-text)] px-4 py-3 font-semibold text-[var(--c-page-body-bg)]" onClick={save}>保存关系与模式档案</button>
      <p className="pb-4 text-xs opacity-60">安全说明：本期不自动从旧人物卡抽取或删除内容，避免破坏精修卡。旧卡中的私密文本仍会留在核心卡里，但现实模式协议会阻止它自动触发；下一期再提供逐段迁移与对比确认。</p>
    </section>
  </PageShell>;
}
