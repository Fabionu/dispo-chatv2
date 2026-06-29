-- Per-user conversation preferences (sidebar row actions).
--
-- Archive / pin / mute / "delete for me" are PER-USER, not global — one person
-- archiving a vehicle room must not change it for anyone else. group_members is
-- already the per-(user, group) row (it carries last_read_at + the denormalized
-- unread counters from 0020), so these live there too rather than in a new table.
--
--   archived_at  when set, the conversation is in the user's Archived filter and
--                hidden from All / Groups / Direct (recoverable via Unarchive).
--   pinned_at    when set, the conversation sorts to the top of its filtered list
--                (newest pin first), above the recency-ordered rest.
--   muted        notification preference. Persisted now; the actual notification
--                suppression hooks read it later (TODO: wire when push/desktop
--                notifications land — today only the unread badge exists).
--   hidden_at    "Delete conversation" = delete FOR ME. The row disappears from
--                every list until a NEWER message arrives (last_message_at moves
--                past hidden_at), then it reappears — same model as WhatsApp's
--                per-user clear. Never deletes the group or anyone else's view.
--
-- All nullable / defaulted, so every existing membership row is valid with no
-- backfill. No new index: these are read alongside the row the sidebar query
-- already fetches by (user_id) / PK, and filtering happens on that small per-user
-- set (same rationale as 0020).

alter table group_members
  add column archived_at timestamptz,
  add column pinned_at   timestamptz,
  add column muted       boolean not null default false,
  add column hidden_at   timestamptz;
