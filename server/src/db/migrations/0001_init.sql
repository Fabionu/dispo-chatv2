-- Foundational schema for Dispo-chat.
-- A workspace = one transport company. Users belong to one workspace.
-- Groups (channels) live inside a workspace. Future tables: shipments, quotes,
-- messages, attachments, group_members.

create extension if not exists "pgcrypto";

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table users (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  email           text not null,
  password_hash   text not null,
  display_name    text not null,
  role            text not null default 'dispatcher'
                  check (role in ('admin', 'dispatcher', 'driver', 'partner')),
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz,
  unique (workspace_id, email)
);

create index users_email_idx on users (lower(email));

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text,
  revoked_at   timestamptz
);

create index sessions_user_id_idx on sessions (user_id);
