-- Attachments belong to a single message and never move. We deliberately do
-- NOT cascade-delete from messages: a soft-deleted message keeps its
-- attachment rows so the storage cleanup can be done lazily by a sweep job.
-- For hard-deletes (workspace/group teardown) the existing CASCADE on
-- messages.group_id → groups still drops attachments via the FK on message_id.

create table attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references messages(id) on delete cascade,
  original_name   text not null,
  mime_type       text not null,
  byte_size       bigint not null check (byte_size >= 0),
  storage_path    text not null,
  created_at      timestamptz not null default now()
);

-- Loading a message thread is the only "list attachments" path — keyed by
-- message_id so a single index per author/group covers it.
create index attachments_message_idx on attachments (message_id);
