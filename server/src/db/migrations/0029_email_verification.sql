-- Verified email ownership for all newly-created accounts.
--
-- Existing accounts are backfilled as verified so deploying this migration
-- never locks current users out. New users receive NULL until they consume a
-- one-time verification token (or accept an email-bound workspace invite).
alter table users
  add column email_verified_at timestamptz;

update users
   set email_verified_at = now()
 where email_verified_at is null;

create table email_verification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

-- Resend/confirmation operations always target the user's still-live tokens.
-- Keep this partial index small; historical consumed tokens are audit-only.
create index email_verification_tokens_active_user_idx
  on email_verification_tokens (user_id, created_at desc)
  where consumed_at is null;

-- A company invitation may now be addressed and delivered by email. NULL keeps
-- pre-existing link-only invitations valid and older API clients compatible.
alter table workspace_invites
  add column recipient_email text,
  add column email_sent_at timestamptz;

