-- Pinned messages: a shared, group-wide pin. Any member can pin/unpin a
-- message; pinned_by records who last pinned it. Surfaced in a "Pinned" bar at
-- the top of the conversation for everyone in the group.

alter table messages
  add column pinned_at timestamptz,
  add column pinned_by uuid references users(id) on delete set null;

-- Listing a group's pins is keyed by group + pin recency; partial so the index
-- only carries the (usually few) pinned rows.
create index messages_pinned_idx
  on messages (group_id, pinned_at desc)
  where pinned_at is not null;
