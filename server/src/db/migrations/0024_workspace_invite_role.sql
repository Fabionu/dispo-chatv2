-- Company invite role. When an admin generates an invite link they pick which
-- workspace role the new member receives on registration; the accept handler
-- (server/src/routes/auth.ts) reads this column and stamps it onto the created
-- user instead of the old hardcoded 'dispatcher'.
--
-- The allowed set MIRRORS users.role's check constraint (0001_init.sql) so an
-- invite can never grant a role the users table would reject. The default is
-- 'dispatcher' — exactly the role the accept handler used before this column
-- existed — so invites created prior to this migration keep their previous
-- behaviour and remain fully backward compatible.

alter table workspace_invites
  add column role text not null default 'dispatcher'
    check (role in ('admin', 'dispatcher', 'driver', 'partner'));
