"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { PageShell } from "@/components/ui/page-shell";
import { CharacterGrowthPanel } from "@/components/character/character-growth-panel";
import { CharacterRelationshipPanel } from "@/components/character/character-relationship-panel";

type Section = "index" | "relationship" | "growth" | "privacy";

export function CharacterDeepArchivePanel({ character, onBack, onCharacterChanged }: { character: Character; onBack: () => void; onCharacterChanged?: () => void }) {
  const [section, setSection] = useState<Section>("index");

  if (section === "relationship") return <CharacterRelationshipPanel character={character} onBack={() => setSection("index")} onCharacterChanged={onCharacterChanged} />;
  if (section === "growth") return <CharacterGrowthPanel character={character} onBack={() => setSection("index")} />;
  if (section === "privacy") return <CharacterGrowthPanel character={character} onBack={() => setSection("index")} initialTab="privacy" />;

  const entries = [
    { key: "relationship" as const, no: "01", en: "RELATIONSHIP & SCENARIO", zh: "关系与情境", note: "现实关系、暧昧尺度、亲密档案与情境世界" },
    { key: "growth" as const, no: "02", en: "GROWTH & MEMORY", zh: "成长与记忆", note: "只收录经你确认的人格变化与成长轨迹" },
    { key: "privacy" as const, no: "03", en: "INFORMATION BOUNDARY", zh: "信息边界", note: "控制本角色是否可以读取其他联系人的聊天" },
  ];

  return <PageShell title="" onBack={onBack} className="bg-[var(--c-page-body-bg)]">
    <div className="char-archive-view">
      <div className="char-archive-frame char-deep-frame">
        <div className="char-archive-stamp">CLASSIFIED</div>
        <div className="char-archive-header">
          <div><div className="char-archive-title">DEEP ARCHIVE</div><div className="char-archive-subtitle">{character.name} · PRIVATE RECORD</div></div>
          <div className="char-archive-id">ID: {character.id.slice(0, 8).toUpperCase()}</div>
        </div>
        <div className="char-deep-intro">这里是人物卡的延伸档案。核心人设仍留在原人物卡，关系、成长与权限按层读取。</div>
        <div className="char-deep-list">
          {entries.map(entry => <button key={entry.key} type="button" className="char-deep-row" onClick={() => setSection(entry.key)}>
            <span className="char-deep-no">{entry.no}</span>
            <span className="char-deep-copy"><span className="char-archive-label">{entry.en}</span><b>{entry.zh}</b><small>{entry.note}</small></span>
            <ChevronRight size={16} />
          </button>)}
        </div>
      </div>
    </div>
  </PageShell>;
}
