"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, Clock3, Loader2, MessageCircleMore, RefreshCw, X } from "lucide-react";

import { loadRoleProfilesForCharacter } from "@/lib/reading-companion-library";
import type { CompanionRoleProfile } from "@/lib/reading-companion-types";
import { fetchWereadShelf } from "@/lib/weread-client";
import type { WereadShelfBook } from "@/lib/weread-types";

export function ReadingCompanionPicker({ characterId, characterName, onClose, onChoose }: {
  characterId: string;
  characterName: string;
  onClose: () => void;
  onChoose: (book: WereadShelfBook) => void;
}) {
  const [tab, setTab] = useState<"shelf" | "archive">("shelf");
  const [books, setBooks] = useState<WereadShelfBook[]>([]);
  const [profiles, setProfiles] = useState<CompanionRoleProfile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    const [shelf, archive] = await Promise.all([
      fetchWereadShelf(),
      loadRoleProfilesForCharacter(characterId),
    ]);
    setProfiles(archive);
    if (shelf.ok) setBooks(shelf.data.books);
    else setError(shelf.error.message);
    setBusy(false);
  }

  useEffect(() => { void load(); }, [characterId]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/35" onClick={onClose}>
      <section className="flex max-h-[78dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[var(--c-bg)] shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="flex items-center gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold">和{characterName}共读</h2>
            <p className="mt-0.5 text-[12px] opacity-50">从你的微信读书书架选择</p>
          </div>
          <button type="button" className="ui-bare-btn rounded-full p-2" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>
        <div className="mx-5 grid grid-cols-2 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
          <button type="button" className={`rounded-xl py-2 text-[13px] ${tab === "shelf" ? "bg-[var(--c-surface)] font-semibold shadow-sm" : "opacity-55"}`} onClick={() => setTab("shelf")}>我的书架</button>
          <button type="button" className={`rounded-xl py-2 text-[13px] ${tab === "archive" ? "bg-[var(--c-surface)] font-semibold shadow-sm" : "opacity-55"}`} onClick={() => setTab("archive")}>共读档案 {profiles.length || ""}</button>
        </div>
        <div className="min-h-[320px] flex-1 overflow-y-auto px-5 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-4">
          {busy ? <div className="flex h-48 items-center justify-center gap-2 text-[13px] opacity-55"><Loader2 size={18} className="animate-spin" />正在同步书架…</div> : null}
          {!busy && error ? <div className="rounded-2xl bg-red-500/10 p-4 text-[13px] leading-5 text-red-500"><p>{error}</p><button className="ui-btn ui-btn-outline mt-3" onClick={() => void load()}><RefreshCw size={15} />重试</button></div> : null}
          {!busy && !error && tab === "shelf" ? (
            books.length ? <div className="grid grid-cols-3 gap-x-3 gap-y-5">{books.map(book => (
              <button key={book.bookId} type="button" className="min-w-0 text-left" onClick={() => onChoose(book)}>
                <div className="aspect-[3/4.25] overflow-hidden rounded-xl bg-black/5 shadow-sm dark:bg-white/5">
                  {book.cover ? <img src={book.cover} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center opacity-30"><BookOpen size={28} /></span>}
                </div>
                <strong className="mt-2 block truncate text-[13px]">{book.title}</strong>
                <span className="mt-0.5 block truncate text-[11px] opacity-45">{book.author || "未知作者"}</span>
              </button>
            ))}</div> : <Empty icon={<BookOpen size={28} />} title="书架还是空的" text="先确认微信读书连接正常，并在微信读书中加入书籍。" />
          ) : null}
          {!busy && tab === "archive" ? (
            profiles.length ? <div className="flex flex-col gap-3">{profiles.map(profile => (
              <article key={profile.key} className="app-card p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-sky-500/12 p-2 text-sky-500"><MessageCircleMore size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{profile.bookTitle}</h3>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 opacity-55">{profile.discussionDigest || profile.opinions.at(-1)?.summary || "已经建立档案，等待下一次讨论。"}</p>
                    <div className="mt-2 flex items-center gap-1 text-[11px] opacity-40"><Clock3 size={12} />{new Date(profile.updatedAt).toLocaleDateString()} · {profile.opinions.length} 条角色观点</div>
                  </div>
                  <ChevronRight size={17} className="mt-1 opacity-25" />
                </div>
              </article>
            ))}</div> : <Empty icon={<MessageCircleMore size={28} />} title="还没有共读档案" text="选一本书开始共读，讨论后的角色观点会沉淀在这里。" />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex h-52 flex-col items-center justify-center text-center"><span className="mb-3 opacity-25">{icon}</span><strong className="text-[14px]">{title}</strong><p className="mt-1 max-w-[260px] text-[12px] leading-5 opacity-45">{text}</p></div>;
}
