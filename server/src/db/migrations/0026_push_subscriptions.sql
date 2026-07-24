-- Browser Push API subscriptions. A subscription belongs to the signed-in user
-- who enabled it on that browser profile. The endpoint is globally unique: if a
-- shared browser later signs in as another user, upserting it transfers the
-- endpoint instead of leaking notifications to the previous account.

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);
