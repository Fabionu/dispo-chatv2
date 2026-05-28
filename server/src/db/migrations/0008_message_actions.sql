-- Message actions: reply context + delete-for-everyone bookkeeping.
--
-- `reply_to_message_id` is the message this one is a reply to. ON DELETE SET
-- NULL: if the parent is purged (hard-delete only, e.g. group teardown) the
-- reply survives as a normal message — the snippet just disappears.
--
-- `deleted_by` records who tombstoned the message. We already had
-- `deleted_at` as a soft-delete marker; pairing it with the actor lets the
-- UI render "You deleted this message" vs "This message was deleted".

alter table messages
  add column reply_to_message_id uuid references messages(id) on delete set null,
  add column deleted_by          uuid references users(id);

-- Looking up the parent of any single message is by-id (PK). We instead
-- index the reverse direction — "what messages reply to X" — for the
-- eventual "show replies" feature; cheap to add now.
create index messages_reply_to_idx
  on messages (reply_to_message_id)
  where reply_to_message_id is not null;
