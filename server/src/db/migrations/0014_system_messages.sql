-- System / activity messages.
--
-- A general foundation for persisted, in-timeline activity entries (starting
-- with pin/unpin). Rather than a separate table, an activity entry is just a
-- message with kind='system', so it flows through the existing list query,
-- pagination, cache, and socket plumbing unchanged — only rendering differs.
--
--   kind                     'user' (default, every existing row) | 'system'
--   system_event             e.g. 'message_pinned' | 'message_unpinned'
--   system_actor_id          who performed the action (also stored as author_id
--                            so the existing users join yields the actor name)
--   system_target_message_id the message the action refers to (e.g. the pinned
--                            one); ON DELETE SET NULL so purging the target
--                            leaves a still-renderable "a message" entry
--   system_payload           reserved for future structured detail
--
-- Safety: `kind` is added with a constant default, so on Postgres 11+ this is a
-- metadata-only change (no table rewrite). The CHECK is satisfied by the
-- default for every existing row, and the new FK columns are all NULL on
-- existing rows, so the foreign keys validate trivially. No backfill needed.
--
-- No new index: system rows are read via the same (group_id, created_at) scan
-- as user messages (see 0013), and they're a small fraction of the timeline.

alter table messages
  add column kind text not null default 'user' check (kind in ('user', 'system')),
  add column system_event text,
  add column system_actor_id uuid references users(id) on delete set null,
  add column system_target_message_id uuid references messages(id) on delete set null,
  add column system_payload jsonb;
