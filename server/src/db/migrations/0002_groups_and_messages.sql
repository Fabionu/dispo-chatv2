-- Groups (channels), membership, and messages.
--
-- Group types at MVP: 'vehicle' (one channel per truck/trip), 'direct' (1:1 DM
-- between two workspace members). The `type` check constraint can be extended
-- later (e.g. add 'offer', 'general') without rewriting consumers.
--
-- The `meta` jsonb column on groups holds type-specific structured data:
--   vehicle  → { "plate": "B-123-ABC", "trip": "Cluj → Berlin", "started_at": ... }
--   direct   → {}   (membership defines the pair)
-- This avoids growing the table every time we add a group type.

create table groups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  type          text not null check (type in ('vehicle', 'direct')),
  name          text,                                       -- null OK for 'direct' (computed at read)
  description   text,
  meta          jsonb not null default '{}'::jsonb,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Active groups in a workspace — the bread-and-butter query.
create index groups_workspace_active_idx
  on groups (workspace_id)
  where archived_at is null;

create table group_members (
  group_id      uuid not null references groups(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  role          text not null default 'member' check (role in ('admin', 'member')),
  joined_at     timestamptz not null default now(),
  last_read_at  timestamptz,
  primary key (group_id, user_id)
);

-- "List groups for user X" runs constantly (group sidebar load).
create index group_members_user_idx on group_members (user_id);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  author_id   uuid not null references users(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);

-- Paged message history for a group, newest first. Partial index excludes
-- soft-deleted rows so they don't bloat the working set.
create index messages_group_time_idx
  on messages (group_id, created_at desc)
  where deleted_at is null;
