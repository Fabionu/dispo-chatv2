-- Fast substring search for the people directory.
--
-- The directory lets a user search every other user on the platform by name,
-- email, or company. That query uses ILIKE '%term%' — a leading wildcard,
-- which a plain btree index cannot serve, so without help it would scan the
-- whole users table on every keystroke.
--
-- pg_trgm + GIN trigram indexes make ILIKE '%term%' index-assisted, keeping
-- directory search fast as the user base grows into the hundreds of thousands.

create extension if not exists pg_trgm;

create index users_display_name_trgm on users using gin (display_name gin_trgm_ops);
create index users_email_trgm        on users using gin (email gin_trgm_ops);
create index workspaces_name_trgm    on workspaces using gin (name gin_trgm_ops);
