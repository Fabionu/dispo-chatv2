-- Group avatar image for vehicle groups. A permanent vehicle group can carry an
-- optional image (e.g. a photo of the truck) shown in the chat header next to
-- the name, mirroring how user avatars work for DMs.
--
-- `avatar_path` holds the Supabase Storage object key (NULL → the client renders
-- the themed multi-user fallback icon, same pattern as users.avatar_path and
-- workspaces.logo_path). Direct groups never set it.

alter table groups
  add column avatar_path text;
