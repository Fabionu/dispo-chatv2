-- Forward + per-user "delete for me".
--
-- `forwarded` marks a message that was created by forwarding another one, so
-- the client can render a subtle "Forwarded" label. We deliberately don't
-- track the source message id — a forward is a fresh, standalone message that
-- copies the body/attachments and must survive deletion of the original.
--
-- `message_deletions` records that a single user has hidden a message just for
-- themselves. This is distinct from the `deleted_at` tombstone (delete for
-- everyone): a per-user row never affects what anyone else sees, and the
-- message stays fully intact for other members.

alter table messages
  add column forwarded boolean not null default false;

create table message_deletions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- The message-list query filters "messages this user hasn't hidden" via a
-- NOT EXISTS keyed on (message_id, user_id) — covered by the PK above.
