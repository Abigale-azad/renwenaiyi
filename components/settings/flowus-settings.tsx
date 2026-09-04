"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  LogOut,
  Save,
  Search,
  ShieldCheck,
  Table2,
  RefreshCw,
  User,
  Users,
  FolderOpen,
} from "lucide-react";

import type { FlowusConfig } from "@/lib/flowus-types";
import {
  connectFlowus,
  createFlowusInboxDatabase,
  createFlowusTodoDatabase,
  disconnectFlowus,
  getFlowusConfigClient,
  searchFlowusDatabases,
  searchFlowusPages,
  updateFlowusConfigClient,
  testFlowusConnection,
} from "@/lib/flowus-client";

interface DatabaseOption {
  id: string;
  title: string;
}

export function FlowusSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<FlowusConfig | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dbOptions, setDbOptions] = useState<DatabaseOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [pageQuery, setPageQuery] = useState("");
  const [pageOptions, setPageOptions] = useState<DatabaseOption[]>([]);
  const [searchingPages, setSearchingPages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [userInfo, setUserInfo] = useState<{ id: string; name: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const payload = await getFlowusConfigClient();
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "读取连接状态失败。");
      setConnected(payload.data.connected);
      setConfig(payload.data.config);
      if (payload.data.connected) {
        // 已连接时顺便拉一下用户信息做概览展示
        const me = await testFlowusConnection();
        if (me.ok && me.data) setUserInfo(me.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取连接状态失败。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function connect() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = await connectFlowus(token.trim());
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "连接失败。");
      setToken("");
      setConnected(true);
      setConfig(payload.data.config);
      onNotice("FlowUs 已连接");
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败。");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = await disconnectFlowus();
      if (!payload.ok) throw new Error(payload.error?.message || "断开失败。");
      setConnected(false);
      setConfig(null);
      setUserInfo(null);
      onNotice("已断开 FlowUs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "断开失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setError("");
    try {
      const result = await testFlowusConnection();
      if (!result.ok || !result.data) throw new Error(result.error?.message || "测试失败");
      setUserInfo(result.data);
      onNotice(`连接正常：${result.data.name || result.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function searchDbs() {
    if (searching) return;
    setSearching(true);
    setError("");
    try {
      const payload = await searchFlowusDatabases(query.trim() || "");
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "搜索失败。");
      setDbOptions(payload.data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败。");
    } finally {
      setSearching(false);
    }
  }

  async function searchPages() {
    if (searchingPages) return;
    setSearchingPages(true);
    setError("");
    try {
      const payload = await searchFlowusPages(pageQuery.trim() || "");
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "搜索失败。");
      setPageOptions(payload.data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败。");
    } finally {
      setSearchingPages(false);
    }
  }

  async function createInbox() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = await createFlowusInboxDatabase(config?.parent_page_id);
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "创建失败。");
      const next: FlowusConfig = { ...(config ?? {} as FlowusConfig), inbox_database_id: payload.data.id, inbox_database_title: payload.data.title };
      setConfig(next);
      await updateFlowusConfigClient(next);
      onNotice(`已创建收藏收件箱：${payload.data.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function createTodoDb() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = await createFlowusTodoDatabase(config?.parent_page_id);
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "创建失败。");
      const next: FlowusConfig = {
        ...(config ?? {} as FlowusConfig),
        todo_database_id: payload.data.id,
        todo_database_title: payload.data.title,
        todo_status_field: "状态",
        todo_done_value: "完成",
      };
      setConfig(next);
      await updateFlowusConfigClient(next);
      onNotice(`已创建待办多维表：${payload.data.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (saving || !config) return;
    setSaving(true);
    setError("");
    try {
      const payload = await updateFlowusConfigClient(config);
      if (!payload.ok || !payload.data) throw new Error(payload.error?.message || "保存失败。");
      setConfig(payload.data.config);
      onNotice("配置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function setInboxDb(id: string, title: string) {
    setConfig((prev) => prev ? { ...prev, inbox_database_id: id, inbox_database_title: title } : prev);
  }

  function setTodoDb(id: string, title: string) {
    setConfig((prev) => prev ? { ...prev, todo_database_id: id, todo_database_title: title } : prev);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="app-card overflow-hidden p-5" style={{ background: "linear-gradient(145deg, color-mix(in srgb, var(--c-surface) 90%, #8b5cf6 10%), var(--c-surface))" }}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-500"><Database size={23} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold">FlowUs</h2>
              {busy ? <Loader2 size={15} className="animate-spin opacity-60" /> : connected ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">已连接</span> : <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] opacity-60">未连接</span>}
            </div>
            <p className="mt-1 text-[13px] leading-5 opacity-60">连接你的 FlowUs 工作区，把待办、多维表、收藏和资料检索接入小手机。</p>
          </div>
        </div>
      </section>

      {!connected ? (
        <section className="app-card p-5">
          <label className="text-[13px] font-medium" htmlFor="flowus-token">FlowUs Integration Token</label>
          <input id="flowus-token" className="ui-input mt-2 w-full" type="password" autoComplete="off" placeholder="粘贴你的 Integration Token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button type="button" className="ui-btn ui-btn-primary mt-3 w-full" onClick={() => void connect()} disabled={busy || !token.trim()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}测试并保存
          </button>
          <p className="mt-3 text-[12px] leading-5 opacity-55">Token 会加密保存到仅服务器可读的登录 Cookie，不会出现在本地存储或聊天记录。</p>
          <a className="ui-btn ui-btn-outline mt-3 w-full" href="https://flowus.cn/settings/integrations" target="_blank" rel="noreferrer">打开 FlowUs 集成管理<ExternalLink size={15} /></a>
        </section>
      ) : (
        <>
          <section className="app-card p-5" style={{ background: "linear-gradient(145deg, color-mix(in srgb, var(--c-surface) 90%, #10b981 10%), var(--c-surface))" }}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500"><CheckCircle2 size={23} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-semibold">FlowUs 已连接</h2>
                  {busy ? <Loader2 size={15} className="animate-spin opacity-60" /> : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">正常</span>}
                </div>
                <p className="mt-1 text-[13px] leading-5 opacity-60 truncate">
                  {userInfo ? userInfo.name || userInfo.id : "连接到你的 FlowUs 工作区"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => void handleTest()} disabled={testing}>
                {testing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {testing ? "测试中" : "测试连接"}
              </button>
              <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => void disconnect()} disabled={busy}>
                <LogOut size={16} />断开
              </button>
            </div>
          </section>

          <section className="app-card p-5">
            <h3 className="font-semibold flex items-center gap-2"><User size={18} />当前概览</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[12px] opacity-50 w-20 shrink-0">工作区</span>
                <span className="text-[13px] truncate flex-1">{userInfo?.name || userInfo?.id || "—"}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] opacity-50 w-20 shrink-0">父页面</span>
                <span className="text-[13px] truncate flex-1">{config?.parent_page_title || config?.parent_page_id || <span className="opacity-50">根目录</span>}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] opacity-50 w-20 shrink-0">待办多维表</span>
                <span className="text-[13px] truncate flex-1">{config?.todo_database_title || config?.todo_database_id || <span className="opacity-50">未选择</span>}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] opacity-50 w-20 shrink-0">收藏收件箱</span>
                <span className="text-[13px] truncate flex-1">{config?.inbox_database_title || config?.inbox_database_id || <span className="opacity-50">未选择</span>}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] opacity-50 w-20 shrink-0">角色范围</span>
                <span className="text-[13px] flex-1 flex items-center gap-1.5">
                  {config?.character_scope === "character" ? (
                    <> <Users size={13} className="opacity-60" /> 仅指定角色</>
                  ) : (
                    <> <Users size={13} className="opacity-60" /> 所有角色共享</>
                  )}
                </span>
              </div>
            </div>
            {(!config?.todo_database_id || !config?.inbox_database_id) && (
              <p className="mt-3 text-[12px] leading-5 text-amber-600 dark:text-amber-400">
                ⚠️ 待办表或收件箱未配置，角色可能无法正常写入。请在下方选择或创建。
              </p>
            )}
          </section>

          <section className="app-card p-5">
            <h3 className="font-semibold flex items-center gap-2"><FolderOpen size={18} />父页面</h3>
            <p className="mt-1 text-[13px] leading-5 opacity-60">新建的待办表和收件箱会放在这个页面下面。页面级集成必须选择一个已授权的页面作为父级。</p>

            <div className="mt-4 flex gap-2">
              <input className="ui-input flex-1" placeholder="搜索 FlowUs 页面" value={pageQuery} onChange={(e) => setPageQuery(e.target.value)} />
              <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => void searchPages()} disabled={searchingPages}><Search size={16} />{searchingPages ? "搜索中" : "搜索"}</button>
            </div>

            {pageOptions.length > 0 && (
              <div className="mt-3 max-h-48 overflow-auto rounded-2xl border border-black/5">
                {pageOptions.map((page) => (
                  <div key={page.id} className="flex items-center justify-between border-b border-black/5 px-3 py-2 last:border-0">
                    <span className="truncate text-[13px]">{page.title || "未命名页面"}</span>
                    <button type="button" className="text-[12px] text-violet-500" onClick={() => {
                      setConfig((prev) => prev ? { ...prev, parent_page_id: page.id, parent_page_title: page.title } : prev);
                      setPageOptions([]);
                      setPageQuery("");
                    }}>设为父页面</button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-black/[0.02] px-3 py-2">
              <div className="text-[12px] opacity-60">当前父页面</div>
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">{config?.parent_page_title || config?.parent_page_id || "未选择（默认工作区根目录）"}</div>
                {config?.parent_page_id && (
                  <button type="button" className="text-[12px] text-red-500" onClick={() => setConfig((prev) => prev ? { ...prev, parent_page_id: undefined, parent_page_title: undefined } : prev)}>清除</button>
                )}
              </div>
            </div>
          </section>

          <section className="app-card p-5">
            <h3 className="font-semibold flex items-center gap-2"><Table2 size={18} />数据库配置</h3>
            <p className="mt-1 text-[13px] leading-5 opacity-60">选择或创建两个多维表：一个用来收藏聊天资料，一个用来管理待办。</p>

            <div className="mt-4 flex gap-2">
              <input className="ui-input flex-1" placeholder="搜索 FlowUs 数据库" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => void searchDbs()} disabled={searching}><Search size={16} />{searching ? "搜索中" : "搜索"}</button>
            </div>

            {dbOptions.length > 0 && (
              <div className="mt-3 max-h-48 overflow-auto rounded-2xl border border-black/5">
                {dbOptions.map((db) => (
                  <div key={db.id} className="flex items-center justify-between border-b border-black/5 px-3 py-2 last:border-0">
                    <span className="truncate text-[13px]">{db.title || "未命名数据库"}</span>
                    <div className="flex gap-2">
                      <button type="button" className="text-[12px] text-violet-500" onClick={() => setInboxDb(db.id, db.title)}>设为收件箱</button>
                      <button type="button" className="text-[12px] text-violet-500" onClick={() => setTodoDb(db.id, db.title)}>设为待办</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => void createInbox()} disabled={busy}>+ 新建收件箱</button>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => void createTodoDb()} disabled={busy}>+ 新建待办表</button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-black/[0.02] px-3 py-2">
                <div className="text-[12px] opacity-60">收藏收件箱</div>
                <div className="text-[13px] font-medium">{config?.inbox_database_title || config?.inbox_database_id || "未选择"}</div>
              </div>
              <div className="rounded-2xl bg-black/[0.02] px-3 py-2">
                <div className="text-[12px] opacity-60">待办多维表</div>
                <div className="text-[13px] font-medium">{config?.todo_database_title || config?.todo_database_id || "未选择"}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[12px] opacity-60">状态字段名</div>
                  <input className="ui-input mt-1 w-full" value={config?.todo_status_field || "状态"} onChange={(e) => setConfig((prev) => prev ? { ...prev, todo_status_field: e.target.value } : prev)} />
                </div>
                <div>
                  <div className="text-[12px] opacity-60">完成选项名</div>
                  <input className="ui-input mt-1 w-full" value={config?.todo_done_value || "完成"} onChange={(e) => setConfig((prev) => prev ? { ...prev, todo_done_value: e.target.value } : prev)} />
                </div>
              </div>
            </div>

            <button type="button" className="ui-btn ui-btn-primary mt-4 w-full" onClick={() => void saveConfig()} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}保存配置
            </button>
          </section>

          <section className="app-card p-5">
            <h3 className="font-semibold">角色隔离</h3>
            <p className="mt-1 text-[13px] leading-5 opacity-60">控制哪些角色可以把资料写入你的 FlowUs。</p>
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={config?.character_scope !== "character"} onChange={() => setConfig((prev) => prev ? { ...prev, character_scope: "account" } : prev)} />
                所有角色共享
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={config?.character_scope === "character"} onChange={() => setConfig((prev) => prev ? { ...prev, character_scope: "character" } : prev)} />
                仅指定角色
              </label>
            </div>
          </section>
        </>
      )}

      {error ? <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] leading-5 text-red-500">{error}</div> : null}
    </div>
  );
}
