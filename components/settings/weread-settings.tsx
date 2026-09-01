"use client";

import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ExternalLink, Loader2, LogOut, ShieldCheck } from "lucide-react";

type Status = { connected: boolean; source: "server" | "browser" | null };

export function WereadSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<Status>({ connected: false, source: null });
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/weread/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "读取连接状态失败。");
      setStatus({ connected: Boolean(payload.connected), source: payload.source || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取连接状态失败。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function connect() {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/weread/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "连接失败。");
      setApiKey("");
      setStatus({ connected: true, source: payload.source || "browser" });
      onNotice("微信读书已连接，书架同步成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败。");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy || status.source === "server") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/weread/config", { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "断开失败。");
      setStatus({ connected: Boolean(payload.connected), source: payload.source || null });
      onNotice("已断开微信读书");
    } catch (err) {
      setError(err instanceof Error ? err.message : "断开失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="app-card overflow-hidden p-5" style={{ background: "linear-gradient(145deg, color-mix(in srgb, var(--c-surface) 90%, #38bdf8 10%), var(--c-surface))" }}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-500"><BookOpen size={23} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold">微信读书共读</h2>
              {busy ? <Loader2 size={15} className="animate-spin opacity-60" /> : status.connected ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">已连接</span> : <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] opacity-60">未连接</span>}
            </div>
            <p className="mt-1 text-[13px] leading-5 opacity-60">同步书架、阅读进度、划线与你的想法，让角色在聊天里陪你读。</p>
          </div>
        </div>
      </section>

      {status.connected ? (
        <section className="app-card p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={21} className="mt-0.5 shrink-0 text-emerald-500" />
            <div className="flex-1">
              <h3 className="font-semibold">连接可用</h3>
              <p className="mt-1 text-[13px] leading-5 opacity-60">现在回到任意角色聊天，发送“陪我读书《书名》”即可开始。Key 不会显示在页面或写入本地存储。</p>
              {status.source === "server" ? <p className="mt-2 text-[12px] text-sky-500">由部署环境统一配置，需在 Vercel 环境变量中更换。</p> : null}
            </div>
          </div>
          {status.source !== "server" ? <button type="button" className="ui-btn ui-btn-outline mt-4 w-full" onClick={() => void disconnect()} disabled={busy}><LogOut size={16} />断开连接</button> : null}
        </section>
      ) : (
        <section className="app-card p-5">
          <label className="text-[13px] font-medium" htmlFor="weread-api-key">微信读书 API Key</label>
          <input id="weread-api-key" className="ui-input mt-2 w-full" type="password" autoComplete="off" placeholder="粘贴 wrk- 开头的 Key" value={apiKey} onChange={event => setApiKey(event.target.value)} />
          <button type="button" className="ui-btn ui-btn-primary mt-3 w-full" onClick={() => void connect()} disabled={busy || !apiKey.trim()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}测试并保存
          </button>
          <p className="mt-3 text-[12px] leading-5 opacity-55">点击后会先读取一次书架确认 Key 有效，再加密保存到仅服务器可读的登录 Cookie。</p>
        </section>
      )}

      <section className="app-card p-5">
        <h3 className="font-semibold">还没有 Key？</h3>
        <p className="mt-1 text-[13px] leading-5 opacity-60">打开微信读书官方 Skills 页面，登录你的微信读书账号，按页面提示生成 API Key；复制后回来粘贴即可。</p>
        <a className="ui-btn ui-btn-outline mt-3 w-full" href="https://weread.qq.com/r/weread-skills" target="_blank" rel="noreferrer">打开官方授权页<ExternalLink size={15} /></a>
      </section>

      {error ? <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] leading-5 text-red-500">{error}</div> : null}
    </div>
  );
}
