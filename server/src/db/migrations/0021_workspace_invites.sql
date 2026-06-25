-- Company (workspace) invite links. An admin generates a single-use, short-lived
-- link; the invitee opens it and registers an account that is attached to the
-- inviting workspace. This is NOT `group_invitations` (intra-workspace, targets a
-- vehicle group for an EXISTING user) nor `connections` (cross-company handshake)
-- — it onboards a BRAND-NEW user into a company.
--
-- Security: only the SHA-256 hash of the token is stored, never the raw secret
-- (it lives only in the URL handed to the invitee). Lifecycle is enforced in the
-- accept handler under a row lock: a row is usable only while used_at is null and
-- expires_at is in the future, and accepting sets used_at + used_by atomically,
-- so a link is strictly single-use and dies after 15 minutes.

create table workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  -- SHA-256 hex of the raw token. Unique so a (vanishingly unlikely) token
  -- collision can't shadow another invite, and so lookups seek by hash.
  token_hash    text not null unique,
  created_by    uuid not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  -- Set the moment the invite is consumed; its presence = "used" (single-use).
  used_at       timestamptz,
  used_by       uuid references users(id) on delete set null
);

-- "List this workspace's invites, newest first" drives the admin members panel.
create index workspace_invites_workspace_idx
  on workspace_invites (workspace_id, created_at desc);
