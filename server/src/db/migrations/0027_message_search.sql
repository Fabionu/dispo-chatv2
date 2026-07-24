-- Full-conversation substring search. pg_trgm is already enabled by migration
-- 0006, but keeping the extension guard here makes this migration standalone.
-- The partial GIN index matches the search endpoint's immutable predicates and
-- avoids indexing system activity rows or deleted message bodies.

create extension if not exists pg_trgm;

create index messages_body_trgm
  on messages using gin (body gin_trgm_ops)
  where kind = 'user' and deleted_at is null;
