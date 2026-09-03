-- ============================================================================
-- FlowUs 集成 · Supabase 初始化脚本
-- 在 Supabase SQL Editor 整段执行一次即可建齐 FlowUs 连接配置与操作账本。
-- 依赖：docs/account-supabase.sql 已执行（app_users 表）。
-- ============================================================================

create table if not exists public.app_flowus_configs (
  account_id text primary key references public.app_users(id) on delete cascade,
  connected boolean not null default false,
  parent_page_id text,
  parent_page_title text,
  inbox_database_id text,
  inbox_database_title text,
  todo_database_id text,
  todo_database_title text,
  todo_status_field text,
  todo_done_value text,
  character_scope text not null default 'account' check (character_scope in ('account', 'character')),
  allowed_character_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_flowus_configs is 'FlowUs 账号级连接配置与数据库映射';

alter table public.app_flowus_configs enable row level security;

create table if not exists public.app_flowus_operations (
  uuid uuid primary key default gen_random_uuid(),
  account_id text not null references public.app_users(id) on delete cascade,
  character_id text,
  action text not null check (action in (
    'create_todo', 'update_todo', 'query_todo',
    'create_database_row', 'query_database',
    'save_chat_favorite', 'search',
    'create_inbox', 'create_todo_db'
  )),
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'partial', 'failed')),
  upstream_request_id text,
  upstream_error_code text,
  upstream_error_message text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_flowus_operations is 'FlowUs 操作账本：自然语言草稿、执行状态、上游错误、返回结果';

alter table public.app_flowus_operations enable row level security;

create index if not exists app_flowus_operations_account_idx
  on public.app_flowus_operations (account_id, created_at desc);

create index if not exists app_flowus_operations_action_idx
  on public.app_flowus_operations (account_id, action, created_at desc);

create index if not exists app_flowus_operations_status_idx
  on public.app_flowus_operations (status, created_at);

-- ===== FlowUs 结束 =====
