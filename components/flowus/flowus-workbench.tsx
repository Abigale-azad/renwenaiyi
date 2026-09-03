"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, Database, Loader2, Plus, RefreshCw, Save, Search, Table2, Trash2, X } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import type { FlowusConfig, FlowusOperation } from "@/lib/flowus-types";
import {
  archiveFlowusDatabaseRow,
  createFlowusDatabaseRow,
  createFlowusTodo,
  getFlowusConfigClient,
  getFlowusDatabase,
  listFlowusOperations,
  queryFlowusDatabase,
  queryFlowusTodo,
  saveChatFavorite,
  searchFlowusDatabases,
  semanticSearchFlowus,
  updateFlowusDatabaseRow,
  updateFlowusTodo,
} from "@/lib/flowus-client";

type Tab = "todo" | "database" | "favorite" | "operation";

type DbRecord = {
  id: string;
  title: string;
  properties: Record<string, unknown>;
};

type DbSchema = {
  id: string;
  title: string;
  properties: { id: string; name: string; type: string; options?: { name: string; color?: string }[] }[];
};

export function FlowusWorkbench({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [config, setConfig] = useState<FlowusConfig | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refreshConfig() {
    setLoading(true);
    setError("");
    try {
      const payload = await getFlowusConfigClient();
      if (!payload.ok) throw new Error(payload.error?.message || "读取配置失败");
      setConnected(payload.data?.connected ?? false);
      setConfig(payload.data?.config ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refreshConfig(); }, []);

  return (
    <PageShell
      title="FlowUs 工作台"
      onBack={onClose}
      rightAction={
        <button type="button" className="p-2 opacity-70" onClick={() => void refreshConfig()} aria-label="刷新">
          <RefreshCw size={20} />
        </button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <section className="app-card overflow-hidden p-4" style={{ background: "linear-gradient(145deg, color-mix(in srgb, var(--c-surface) 90%, #8b5cf6 10%), var(--c-surface))" }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-500"><Database size={21} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold">FlowUs</h2>
                {loading ? <Loader2 size={14} className="animate-spin opacity-60" /> : connected ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-500">已连接</span> : <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] opacity-60">未连接</span>}
              </div>
              <p className="mt-0.5 text-[12px] leading-4 opacity-60">
                {config?.todo_database_title ? `待办：${config.todo_database_title}` : "未配置待办表"}
                {" · "}
                {config?.inbox_database_title ? `收件箱：${config.inbox_database_title}` : "未配置收件箱"}
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-black/[0.03] p-1">
          {[
            { id: "todo" as const, label: "待办" },
            { id: "database" as const, label: "多维表" },
            { id: "favorite" as const, label: "收藏" },
            { id: "operation" as const, label: "同步" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-1 py-2 text-[13px] font-medium transition ${activeTab === tab.id ? "bg-violet-500 text-white shadow-sm" : "opacity-70 hover:opacity-100"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!connected && !loading && (
          <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[13px] leading-5 text-amber-600">
            尚未连接 FlowUs。请先到「设置 → 连接 → FlowUs」配置 Integration Token。
          </div>
        )}

        {error ? <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] leading-5 text-red-500">{error}</div> : null}

        {activeTab === "todo" && <TodoTab config={config} connected={connected} />}
        {activeTab === "database" && <DatabaseTab config={config} connected={connected} />}
        {activeTab === "favorite" && <FavoriteTab config={config} connected={connected} />}
        {activeTab === "operation" && <OperationTab />}
      </div>
    </PageShell>
  );
}

function TodoTab({ config, connected }: { config: FlowusConfig | null; connected: boolean }) {
  const [items, setItems] = useState<DbRecord[]>([]);
  const [filter, setFilter] = useState<string>("待办");
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const statusField = config?.todo_status_field || "状态";
  const doneValue = config?.todo_done_value || "完成";

  async function load() {
    if (!connected || !config?.todo_database_id) return;
    setBusy(true);
    try {
      const payload = await queryFlowusTodo({ status: filter || undefined });
      if (payload.ok && payload.data) {
        setItems((payload.data.results as DbRecord[]) ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [connected, config?.todo_database_id, filter]);

  async function addTodo() {
    if (!newTitle.trim() || !config?.todo_database_id) return;
    setBusy(true);
    try {
      await createFlowusTodo(newTitle.trim(), { status: filter || "待办" });
      setNewTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: DbRecord) {
    const current = String(item.properties[statusField] ?? "");
    const next = current === doneValue ? "待办" : doneValue;
    setBusy(true);
    try {
      await updateFlowusTodo(item.id, { status: next });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-auto pb-1">
        {["全部", "待办", "进行中", doneValue].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s === "全部" ? "" : s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium ${filter === (s === "全部" ? "" : s) ? "bg-violet-500 text-white" : "bg-black/5 opacity-70"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input className="ui-input flex-1 text-[13px]" placeholder="新建待办…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addTodo(); }} />
        <button type="button" className="ui-btn ui-btn-primary shrink-0" onClick={() => void addTodo()} disabled={busy || !newTitle.trim()}><Plus size={16} /></button>
      </div>

      {busy && items.length === 0 ? <div className="py-8 text-center text-[13px] opacity-50"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中…</div> : null}

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const status = String(item.properties[statusField] ?? "");
          const done = status === doneValue;
          return (
            <div key={item.id} className="app-card flex items-start gap-3 p-3">
              <button type="button" onClick={() => void toggle(item)} className={`mt-0.5 shrink-0 rounded-full border-2 p-0.5 ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-black/20"}`}>
                {done ? <CheckCircle2 size={14} /> : <span className="block size-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] leading-5 ${done ? "opacity-50 line-through" : ""}`}>{item.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] opacity-50">
                  <span>{status || "无状态"}</span>
                  {item.properties["截止日期"] ? <span>截止：{String(item.properties["截止日期"])}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
        {!busy && items.length === 0 && <div className="py-8 text-center text-[13px] opacity-50">暂无待办</div>}
      </div>
    </div>
  );
}

function DatabaseTab({ config, connected }: { config: FlowusConfig | null; connected: boolean }) {
  const [databases, setDatabases] = useState<{ id: string; title: string }[]>([]);
  const [selectedDbId, setSelectedDbId] = useState<string>(config?.todo_database_id || "");
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [records, setRecords] = useState<DbRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusField, setStatusField] = useState<string>("状态");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newRowTitle, setNewRowTitle] = useState("");

  async function loadDatabases() {
    if (!connected) return;
    const payload = await searchFlowusDatabases("");
    if (payload.ok && payload.data) {
      setDatabases(payload.data.results);
      if (!selectedDbId && payload.data.results.length > 0) {
        setSelectedDbId(payload.data.results[0].id);
      }
    }
  }

  async function loadSchemaAndRecords(dbId: string) {
    if (!dbId) return;
    setBusy(true);
    try {
      const schemaRes = await getFlowusDatabase(dbId);
      if (schemaRes.ok && schemaRes.data) {
        setSchema(schemaRes.data);
        const statusProp = schemaRes.data.properties.find((p) => p.type === "select" && /状态|state|status/i.test(p.name));
        if (statusProp) setStatusField(statusProp.name);
      }
      const recordsRes = await queryFlowusDatabase(dbId, { pageSize: 100 });
      if (recordsRes.ok && recordsRes.data) {
        setRecords((recordsRes.data.results as DbRecord[]) ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadDatabases(); }, [connected]);
  useEffect(() => { if (selectedDbId) void loadSchemaAndRecords(selectedDbId); }, [selectedDbId]);

  const groups = useMemo(() => {
    const map = new Map<string, DbRecord[]>();
    records.forEach((r) => {
      const status = String(r.properties[statusField] ?? "未分组");
      if (!map.has(status)) map.set(status, []);
      map.get(status)!.push(r);
    });
    return Array.from(map.entries());
  }, [records, statusField]);

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records;
    return records.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()));
  }, [records, search]);

  async function addRow() {
    if (!selectedDbId || !newRowTitle.trim()) return;
    setBusy(true);
    try {
      await createFlowusDatabaseRow(selectedDbId, newRowTitle.trim());
      setNewRowTitle("");
      setShowAdd(false);
      await loadSchemaAndRecords(selectedDbId);
    } finally {
      setBusy(false);
    }
  }

  async function archive(item: DbRecord) {
    if (!confirm(`归档「${item.title}」？`)) return;
    setBusy(true);
    try {
      await archiveFlowusDatabaseRow(item.id);
      await loadSchemaAndRecords(selectedDbId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <select className="ui-input flex-1 text-[13px]" value={selectedDbId} onChange={(e) => setSelectedDbId(e.target.value)}>
          <option value="">选择多维表</option>
          {databases.map((db) => <option key={db.id} value={db.id}>{db.title || "未命名"}</option>)}
        </select>
        <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => void loadSchemaAndRecords(selectedDbId)} disabled={busy || !selectedDbId}><RefreshCw size={15} /></button>
      </div>

      <div className="flex gap-2">
        <input className="ui-input flex-1 text-[13px]" placeholder="搜索记录…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="ui-btn ui-btn-primary shrink-0" onClick={() => setShowAdd(true)} disabled={!selectedDbId}><Plus size={16} /></button>
      </div>

      {showAdd && (
        <div className="app-card p-3">
          <input className="ui-input w-full text-[13px]" placeholder="新记录标题" value={newRowTitle} onChange={(e) => setNewRowTitle(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-outline text-[12px]" onClick={() => setShowAdd(false)}>取消</button>
            <button type="button" className="ui-btn ui-btn-primary text-[12px]" onClick={() => void addRow()} disabled={busy || !newRowTitle.trim()}>保存</button>
          </div>
        </div>
      )}

      {busy && records.length === 0 ? <div className="py-8 text-center text-[13px] opacity-50"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中…</div> : null}

      <div className="flex flex-col gap-3">
        {search.trim() ? (
          filteredRecords.map((item) => (
            <DbRecordCard key={item.id} item={item} schema={schema} statusField={statusField} onRefresh={() => void loadSchemaAndRecords(selectedDbId)} onArchive={() => void archive(item)} />
          ))
        ) : (
          groups.map(([status, groupItems]) => (
            <div key={status} className="rounded-2xl bg-black/[0.02] p-3">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Table2 size={14} />{status} <span className="text-[11px] opacity-50">({groupItems.length})</span></div>
              <div className="flex flex-col gap-2">
                {groupItems.map((item) => (
                  <DbRecordCard key={item.id} item={item} schema={schema} statusField={statusField} onRefresh={() => void loadSchemaAndRecords(selectedDbId)} onArchive={() => void archive(item)} />
                ))}
              </div>
            </div>
          ))
        )}
        {!busy && records.length === 0 && <div className="py-8 text-center text-[13px] opacity-50">选择多维表后查看记录</div>}
      </div>
    </div>
  );
}

function DbRecordCard({ item, schema, statusField, onRefresh, onArchive }: { item: DbRecord; schema: DbSchema | null; statusField: string; onRefresh: () => void; onArchive: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...item.properties }));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const update: Record<string, unknown> = {};
      schema?.properties.forEach((prop) => {
        const value = draft[prop.name];
        if (value !== undefined && value !== item.properties[prop.name]) {
          update[prop.name] = value;
        }
      });
      await updateFlowusDatabaseRow(item.id, update);
      setEditing(false);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  function setField(name: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="app-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input className="ui-input w-full text-[13px]" value={String(draft[statusField] ?? item.properties[statusField] ?? "")} onChange={(e) => setField(statusField, e.target.value)} />
          ) : (
            <div className="text-[14px] font-medium leading-5">{item.title}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <button type="button" className="rounded-xl p-1.5 text-emerald-500 hover:bg-emerald-500/10" onClick={() => void save()} disabled={busy}><Save size={15} /></button>
          ) : (
            <button type="button" className="rounded-xl p-1.5 opacity-60 hover:bg-black/5" onClick={() => setEditing(true)}><ArrowUpRight size={15} /></button>
          )}
          <button type="button" className="rounded-xl p-1.5 text-red-500 hover:bg-red-500/10" onClick={onArchive} disabled={busy}><Trash2 size={15} /></button>
        </div>
      </div>

      {editing && schema ? (
        <div className="mt-2 grid gap-2">
          {schema.properties.filter((p) => p.name !== statusField && ["rich_text", "select", "date", "url"].includes(p.type)).map((prop) => (
            <div key={prop.id} className="grid grid-cols-[80px_1fr] items-center gap-2 text-[12px]">
              <span className="opacity-60">{prop.name}</span>
              {prop.type === "select" && prop.options ? (
                <select className="ui-input text-[12px]" value={String(draft[prop.name] ?? item.properties[prop.name] ?? "")} onChange={(e) => setField(prop.name, e.target.value)}>
                  <option value="">-</option>
                  {prop.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
              ) : (
                <input className="ui-input text-[12px]" value={String(draft[prop.name] ?? item.properties[prop.name] ?? "")} onChange={(e) => setField(prop.name, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] opacity-50">
          {Object.entries(item.properties).filter(([k]) => k !== "Name" && k !== statusField).slice(0, 4).map(([k, v]) => (
            <span key={k}>{k}: {String(v ?? "-")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function FavoriteTab({ config, connected }: { config: FlowusConfig | null; connected: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ pageId: string; title: string; snippet: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");

  async function search() {
    if (!connected || !query.trim()) return;
    setBusy(true);
    try {
      const payload = await semanticSearchFlowus(query.trim());
      if (payload.ok && payload.data) setResults(payload.data.results);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!connected || !content.trim()) return;
    setBusy(true);
    try {
      await saveChatFavorite({ title: title.trim() || undefined, content: content.trim(), tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) });
      setContent("");
      setTitle("");
      setTags("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="app-card p-3">
        <div className="text-[13px] font-medium">快速收藏</div>
        <input className="ui-input mt-2 w-full text-[13px]" placeholder="标题（可选）" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="ui-input mt-2 w-full text-[13px]" rows={3} placeholder="写点什么…" value={content} onChange={(e) => setContent(e.target.value)} />
        <input className="ui-input mt-2 w-full text-[13px]" placeholder="标签，用逗号分隔" value={tags} onChange={(e) => setTags(e.target.value)} />
        <button type="button" className="ui-btn ui-btn-primary mt-2 w-full" onClick={() => void save()} disabled={busy || !content.trim()}><Save size={15} />保存到收件箱</button>
      </div>

      <div className="flex gap-2">
        <input className="ui-input flex-1 text-[13px]" placeholder="语义搜索资料…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
        <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => void search()} disabled={busy || !query.trim()}><Search size={15} /></button>
      </div>

      {busy && results.length === 0 ? <div className="py-8 text-center text-[13px] opacity-50"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />搜索中…</div> : null}

      <div className="flex flex-col gap-2">
        {results.map((r) => (
          <a key={r.pageId} href={r.url} target="_blank" rel="noreferrer" className="app-card block p-3">
            <div className="text-[14px] font-medium leading-5">{r.title}</div>
            <div className="mt-1 text-[12px] leading-4 opacity-60 line-clamp-3">{r.snippet}</div>
          </a>
        ))}
        {!busy && results.length === 0 && <div className="py-8 text-center text-[13px] opacity-50">输入关键词搜索 FlowUs 资料</div>}
      </div>
    </div>
  );
}

function OperationTab() {
  const [operations, setOperations] = useState<FlowusOperation[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const payload = await listFlowusOperations(30);
      if (payload.ok && payload.data) setOperations(payload.data.operations);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="flex flex-col gap-2">
      {busy && operations.length === 0 ? <div className="py-8 text-center text-[13px] opacity-50"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中…</div> : null}
      {operations.map((op) => (
        <div key={op.id} className="app-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium">{op.action}</span>
            <StatusBadge status={op.status} />
          </div>
          <div className="mt-1 text-[11px] opacity-50">{op.created_at ? new Date(op.created_at).toLocaleString("zh-CN") : ""}</div>
          {op.upstream_error_message ? <div className="mt-1 text-[12px] text-red-500">{op.upstream_error_message}</div> : null}
        </div>
      ))}
      {!busy && operations.length === 0 && <div className="py-8 text-center text-[13px] opacity-50">暂无同步记录</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: FlowusOperation["status"] }) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "执行中",
    success: "成功",
    partial: "部分成功",
    failed: "失败",
  };
  const color = status === "success" ? "bg-emerald-500/15 text-emerald-500" : status === "failed" ? "bg-red-500/10 text-red-500" : "bg-black/5 opacity-70";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${color}`}>{map[status] ?? status}</span>;
}
