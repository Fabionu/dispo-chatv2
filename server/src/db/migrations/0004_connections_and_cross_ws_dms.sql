-- Cross-workspace direct messages, gated by a per-user connection model.
--
-- Two structural changes to `groups` and one new table `connections`.
--
-- 1. groups.workspace_id becomes nullable. A direct chat between users from
--    different workspaces does not belong to any single workspace, so we
--    leave it NULL. Vehicle groups and same-workspace DMs keep workspace_id.
--
-- 2. groups.direct_pair_key is the canonical "user_a:user_b" key (sorted
--    lexically) for type='direct' groups. Combined with a partial unique
--    index it gives us race-free dedup of DMs between the same pair —
--    the application also looks up by this key before inserting, but the DB
--    catches concurrent inserts that slip past the app check.
--
-- 3. connections holds the LinkedIn-style request/accept handshake required
--    for any cross-workspace DM. PK is a synthetic uuid for URL ergonomics;
--    a unique (user_a_id, user_b_id) constraint with a canonical-order CHECK
--    ensures one row per pair regardless of who initiated.

alter table groups alter column workspace_id drop not null;

alter table groups add column direct_pair_key text;

create unique index groups_direct_pair_uniq
  on groups (direct_pair_key)
  where type = 'direct' and direct_pair_key is not null;

-- Defensive: every direct group must carry its pair key. App code sets it
-- on insert; this CHECK prevents accidental NULLs sneaking in via raw SQL.
alter table groups add constraint groups_direct_needs_pair_key
  check (type <> 'direct' or direct_pair_key is not null);

-- Backfill: any direct groups created before this migration (smoke tests
-- etc.) get a pair key derived from their two members.
update groups
   set direct_pair_key = sub.k
  from (
    select group_id,
           string_agg(user_id::text, ':' order by user_id::text) as k
      from group_members
     group by group_id
  ) as sub
 where groups.id = sub.group_id
   and groups.type = 'direct'
   and groups.direct_pair_key is null;

-- ── Connections ──────────────────────────────────────────────────────────

create table connections (
  id            uuid primary key default gen_random_uuid(),
  user_a_id     uuid not null references users(id) on delete cascade,
  user_b_id     uuid not null references users(id) on delete cascade,
  status        text not null check (status in ('pending', 'accepted', 'declined')),
  requested_by  uuid not null references users(id),
  message       text,
  requested_at  timestamptz not null default now(),
  responded_at  timestamptz,
  unique (user_a_id, user_b_id),
  -- Canonical ordering so a request A→B and a "lookup" B→A hit the same row.
  check (user_a_id < user_b_id)
);

-- "Show me my pending requests" runs constantly in the connections UI;
-- both directional indexes let us seek without scanning the whole table.
create index connections_a_status_idx on connections (user_a_id, status);
create index connections_b_status_idx on connections (user_b_id, status);
