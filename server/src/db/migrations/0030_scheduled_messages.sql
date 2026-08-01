-- Private, sender-owned messages that become normal chat messages at a future
-- instant. They are deliberately separate from `messages`: recipients must not
-- see them, count them as unread, or receive realtime/push notifications until
-- the scheduler actually dispatches them.

create table scheduled_messages (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references groups(id) on delete cascade,
  author_id           uuid not null references users(id) on delete cascade,
  body                text not null,
  reply_to_message_id uuid references messages(id) on delete set null,
  mention_user_ids    uuid[] not null default '{}'::uuid[],
  scheduled_for       timestamptz not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'failed')),
  sent_message_id     uuid references messages(id) on delete cascade,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (length(btrim(body)) between 1 and 8000),
  check (cardinality(mention_user_ids) <= 50),
  check ((status = 'sent') = (sent_message_id is not null))
);

-- Hot scheduler path. A partial index keeps already-sent audit rows out of the
-- queue working set and makes each due-job claim an ordered index seek.
create index scheduled_messages_due_idx
  on scheduled_messages (scheduled_for, id)
  where status = 'pending';

-- Sender-owned list shown in the composer (pending and failed only).
create index scheduled_messages_author_active_idx
  on scheduled_messages (author_id, scheduled_for desc)
  where status in ('pending', 'failed');

-- Required for efficient cascades / group-scoped maintenance; neither index
-- above has group_id as its leading column.
create index scheduled_messages_group_idx on scheduled_messages (group_id);
