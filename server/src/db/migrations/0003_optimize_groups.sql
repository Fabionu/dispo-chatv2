-- Scale-oriented additions to groups + group_members.
--
-- 1. `last_message_at` denormalized on groups.
--    The sidebar query "list my groups sorted by recent activity" runs on
--    every page load. Computing max(created_at) from messages per group
--    becomes expensive once we cross a few million messages. Maintaining
--    last_message_at on insert costs one extra UPDATE per message — cheap
--    on write, massive win on read.
--
-- 2. Index supporting the sorted-by-activity query without a sort step.
--
-- 3. Compound index on (user_id, group_id) for group_members. The membership
--    lookup "is user X in group Y" runs on every authorized read of messages.
--    The existing PK is (group_id, user_id) — fine for "members of group Y"
--    but not for "groups of user X", which is what we need most often.

alter table groups add column last_message_at timestamptz;

-- Newest-active groups in a workspace. Drops the previous index since this
-- one supersedes it for our access pattern.
drop index if exists groups_workspace_active_idx;
create index groups_workspace_recent_idx
  on groups (workspace_id, last_message_at desc nulls last)
  where archived_at is null;

-- Membership lookup keyed by user. The original PK already supports the
-- reverse direction, so this is a complement, not a replacement.
create index group_members_user_group_idx
  on group_members (user_id, group_id);
