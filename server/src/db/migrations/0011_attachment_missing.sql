-- Lazily-discovered availability flag for attachments. Set true by the serve
-- route when the backing storage object is found to be gone (e.g. an old
-- upload whose bytes lived on a since-wiped ephemeral disk). Surfaced in the
-- message list so the client renders the "unavailable" card immediately and
-- stops re-requesting a 404 on every render.

alter table attachments
  add column missing boolean not null default false;
