-- Group invitations — invite an existing workspace user into a permanent
-- vehicle group. This is NOT the cross-company connection handshake (that's
-- `connections`); invitations live entirely inside a single workspace and only
-- ever target vehicle groups, which are long-lived operational chats.
--
-- Lifecycle: pending → accepted | declined | cancelled. Accepting inserts the
-- invited user into group_members; the row is retained as history either way.
-- History rows (non-pending) may accumulate, but a partial unique index keeps
-- at most one PENDING invite per (group, user) so re-inviting is idempotent.

create table group_invitations (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references groups(id) on delete cascade,
  invited_user_id     uuid not null references users(id) on delete cascade,
  invited_by_user_id  uuid not null references users(id) on delete cascade,
  status              text not null default 'pending'
                        check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at          timestamptz not null default now(),
  responded_at        timestamptz
);

-- "Show me my pending invites" runs on every app load (the sidebar section);
-- seek by invitee + status without scanning.
create index group_invitations_invitee_status_idx
  on group_invitations (invited_user_id, status);

-- "Who's pending for this group" drives the invite picker's state badges.
create index group_invitations_group_status_idx
  on group_invitations (group_id, status);

-- At most one pending invite per (group, user). Partial so accepted/declined/
-- cancelled history can pile up; the app also checks first, but this catches
-- concurrent double-invites at the DB.
create unique index group_invitations_unique_pending
  on group_invitations (group_id, invited_user_id)
  where status = 'pending';
