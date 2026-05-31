-- Operational user profile fields.
--
-- Extends `users` with the identity/settings a transport operator needs. This
-- is an OPERATIONAL profile, not a social one — no bio, no timezone, no
-- signature. All new columns are nullable / have safe defaults, so existing
-- rows are valid without a backfill.
--
--   avatar_path         storage object key for the profile image (NULL → use
--                       initials fallback). Mirrors attachments.storage_path.
--   job_title           self-descriptive function text, e.g. "Fleet Manager".
--                       Independent of `role` (which stays permission-based).
--   work_phone          work contact number.
--   native_language     primary language.
--   other_languages     additional spoken languages (array).
--   availability_status available | busy | off_duty (defaults to available).

alter table users
  add column avatar_path text,
  add column job_title text,
  add column work_phone text,
  add column native_language text,
  add column other_languages text[] not null default '{}',
  add column availability_status text not null default 'available'
    check (availability_status in ('available', 'busy', 'off_duty'));
