-- @mentions.
--
-- A message can mention one or more users. Mentions are a join table rather
-- than an array column so we can index by mentioned user (for "my unread
-- mentions" per group) and cascade-clean on either side.
--
--   message_id        the message the mention lives in (cascades on delete)
--   mentioned_user_id the user being mentioned (cascades on delete)
--   created_at        when the mention was stored (mirrors the message time)
--
-- Mentions are immutable for now: they're written once at send time and not
-- rewritten on edit. Only kind='user' messages carry them (the API never
-- writes mentions for system rows or forwards).

create table message_mentions (
  message_id uuid not null references messages(id) on delete cascade,
  mentioned_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);

-- "Unread mentions for this user" scans by mentioned_user_id, newest first.
create index message_mentions_user_created_idx
  on message_mentions (mentioned_user_id, created_at desc);

-- Rendering a message's mentions seeks by message_id (also covered by the PK's
-- leading column, but an explicit index keeps the per-message subquery cheap).
create index message_mentions_message_idx
  on message_mentions (message_id);
