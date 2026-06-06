-- Denormalize sidebar unread counters onto group_members.
--
-- GET /api/groups previously computed unread_count and unread_mention_count with
-- correlated subqueries per group (correct + indexed, but O(unread window) per
-- group on every sidebar load). We now keep them as STORED counters maintained
-- incrementally on the write paths (send / read / delete / join), so the sidebar
-- read is a plain column fetch. last_read_at stays the SOURCE OF TRUTH for
-- per-message read receipts/checkmarks — these counters are only the aggregate
-- badge numbers, never the read state itself.
--
-- Invariants the app code maintains (see routes/groups.ts, routes/groupInvites.ts):
--   • new user message  → +1 unread_count for every member except the author;
--                         +1 unread_mention_count for each mentioned member.
--   • system messages   → never counted (the increment only runs on kind='user'
--                         inserts; insertSystemMessage doesn't touch counters).
--   • mark read         → both reset to 0 for the reader (last_read_at advances).
--   • delete-for-everyone / delete-for-me → decrement the affected members'
--                         counters when the message was still UNREAD for them
--                         (floored at 0, never negative).
--   • join existing group → unread_count seeded to the existing visible backlog
--                         so a new member matches what the old subquery showed.

alter table group_members
  add column unread_count integer not null default 0,
  add column unread_mention_count integer not null default 0;

-- Backfill from the EXACT logic the old subqueries used, so stored values match
-- what the sidebar showed before this migration. coalesce(last_read_at, epoch)
-- mirrors "never read = everything unread".
update group_members gm
   set unread_count = (
         select count(*)
           from messages msg
          where msg.group_id = gm.group_id
            and msg.author_id <> gm.user_id
            and msg.deleted_at is null
            and msg.kind = 'user'
            and msg.created_at > coalesce(gm.last_read_at, 'epoch'::timestamptz)
            and not exists (
              select 1 from message_deletions md
               where md.message_id = msg.id and md.user_id = gm.user_id
            )
       ),
       unread_mention_count = (
         select count(*)
           from message_mentions mm
           join messages msg on msg.id = mm.message_id
          where mm.mentioned_user_id = gm.user_id
            and msg.group_id = gm.group_id
            and msg.author_id <> gm.user_id
            and msg.deleted_at is null
            and msg.kind = 'user'
            and msg.created_at > coalesce(gm.last_read_at, 'epoch'::timestamptz)
            and not exists (
              select 1 from message_deletions md
               where md.message_id = msg.id and md.user_id = gm.user_id
            )
       );

-- No new indexes needed. The backfill rides the existing indexes
-- (messages_group_created_idx, message_mentions_user_created_idx, and the
-- message_deletions / group_members PKs); every runtime maintenance UPDATE keys
-- on the group_members PK prefix (group_id, optionally user_id).
