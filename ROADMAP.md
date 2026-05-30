# Dispo-chat v2 Roadmap

Dispo-chat v2 is a rebuilt dispatcher workspace for transport teams. The
foundation includes a React web app, an Express API, a PostgreSQL schema,
workspace signup/signin, stateless JWT auth, real-time chat over Socket.IO,
and cross-company connections.

_Last reconciled with the codebase: 2026-05-21._

## Product Direction

Build a chat-first operations workspace where every conversation is tied to a
real transport object: a shipment, quote, vehicle, driver, partner, or
document. The app should feel closer to an operations cockpit than a generic
messenger.

It is also a **multi-company network**, not a single-tenant tool. Many
transport companies share the platform and interact across workspace
boundaries — exchanging jobs, quotes, and trips. Internal team chat is open
within a workspace; cross-company contact is gated by an explicit connection
handshake.

## Current State

- Monorepo with `web` and `server` workspaces.
- React, Vite, Tailwind, and lucide icons on the frontend.
- Express, PostgreSQL, JWT cookies, bcrypt, Zod, and Socket.IO on the backend.
- Migrations `0001`–`0005` applied. Tables: `workspaces`, `users`, `groups`,
  `group_members`, `messages`, `connections`. (`sessions` was created in
  `0001` but never used and was dropped in `0005` — auth is stateless JWT.)
- Workspace signup creates a company workspace and first admin user.
- Signin, signout, and `/api/auth/me` are implemented.
- Group types in use: `vehicle` (a truck + its trip) and `direct` (1:1 DM).
- Real-time chat: Socket.IO with cookie auth, group rooms, live `message:new`
  and `group:added` events, auto-reconnect.
- Cross-company connections: LinkedIn-style request/accept/decline; DMs
  between different workspaces require an accepted connection.
- Chat UI: rail group list, active conversation view with cursor-paginated
  history and composer, group-creation modals.
- API hardening: Zod validation, rate limits on auth/messages/group creation,
  `httpOnly` same-site cookies, membership-scoped authorization, a central
  `HttpError` + error-handler pattern, `asyncHandler`/`withTransaction` helpers.
- Railway deployment config and Supabase database.

## Phase 0: Foundation Cleanup

Goal: make the skeleton reliable before product complexity piles up.

- [x] Text encoding artifacts — checked, none present; source is clean UTF-8.
- [x] `.env.example` for required local and production variables.
- [x] Session strategy decided: **stateless JWT only**; the unused `sessions`
      table was dropped (`0005`).
- [x] Normalized API error responses (`HttpError` + central error handler).
- [x] Protected-route helper pattern (`requireAuth`, `asyncHandler`,
      `withTransaction`).
- [x] Seed data made safe — production guard, env-driven credentials, no real
      personal emails.
- [ ] Basic request logging (structured access logs) — not yet added.
- [ ] A lightweight automated API test harness for auth — currently only
      manual `curl` smoke tests exist.

Definition of done:

- A new developer can clone, configure, migrate, seed, run, and sign in
  locally. ✅
- `npm run build` stays green. ✅
- The auth path has a repeatable scripted verification. ⏳ (manual only)

## Phase 1: Core Workspace Model

Goal: create the objects that make Dispo-chat more than generic chat.

- [x] Tables for `groups`, `group_members`, `messages`.
- [ ] `attachments` table — not yet added (see Phase 5).
- [ ] Group types — `vehicle` and `direct` exist; `offer`, `shipment`, and
      `general` are not yet implemented.
- [x] Group creation from the workspace UI (vehicle group + direct message
      modals).
- [x] Group list, active group view, and message composer.
- [x] Message author, body, timestamps, and edit/delete metadata columns
      (`edited_at`, `deleted_at`); workspace ownership via `group_members`.
- [x] Workspace-scoped API authorization — every query is gated by group
      membership or workspace.

Definition of done:

- An admin can create a group, open it, send messages, and see them after
  refresh. ✅
- Users cannot access data from another workspace. ✅

## Phase 2: Real-Time Chat

Goal: make conversations operationally useful in live dispatch.

- [x] WebSocket transport (Socket.IO, same port as the HTTP API).
- [x] Broadcast new messages and group creation.
- [ ] Broadcast message edits and deletes — no edit/delete endpoints yet.
- [ ] Online/presence basics for workspace users.
- [ ] True optimistic UI — sent messages currently render on the POST
      response, not before it.
- [x] Active-group read state (`last_read_at`, mark-read on view).
- [ ] Numeric unread counts — only an unread/seen dot exists today.
- [x] Reconnect handling (Socket.IO auto-reconnect with backoff).
- [ ] Missed-event replay after a reconnect gap.

Definition of done:

- Two browser windows in the same workspace update without refresh. ✅
- Temporary network loss does not duplicate messages — dedup by message id. ✅

## Cross-Company Network

Goal: let companies discover and contact each other safely. _(New track —
not in the original plan; added as the product became multi-tenant.)_

- [x] `connections` table — per-pair request/accept/decline, canonical
      ordering, indexed both directions.
- [x] Connection request / accept / decline API with real-time notifications.
- [x] Cross-workspace DMs gated by an accepted connection; same-workspace DMs
      stay open.
- [ ] Connections UI — an inbox for pending requests (backend is ready, no
      screen yet).
- [ ] Company directory — searchable list of companies and public profiles
      for discovery.
- [ ] Decide email identity: emails are unique per workspace today, so the
      same address can create multiple accounts. A global one-account-per-
      email model is likely needed before public launch.
- [ ] Anti-abuse for connection requests (limits, reporting, blocking).

## Phase 3: Transport Operations Layer

Goal: tie chat to dispatch workflows.

- [ ] Shipment/load records: origin, destination, pickup/delivery windows,
      status, reference numbers, assigned vehicle/driver.
- [ ] Quote records: customer/partner, price, currency, status, expiry,
      linked conversation.
- [ ] Vehicle records: plate, driver, capacity, location notes, status.
- [ ] Milestones: quoted, accepted, loading, loaded, in transit, delivered,
      POD received, invoiced.
- [ ] Sidebar summaries inside each group so users see the operational object
      while chatting.

Definition of done:

- A dispatcher can create a load, discuss it in a linked group, update its
  status, and find it again later.

## Phase 4: Team And Permissions

Goal: support real company usage.

- [ ] Invitations by email.
- [ ] Role permissions for admin, dispatcher, driver, and partner.
- [ ] Workspace member management.
- [ ] Driver/partner restricted views.
- [ ] Password reset and email verification.
- [ ] Audit fields for sensitive changes.

Definition of done:

- A company can invite staff and external partners without exposing unrelated
  conversations or workspace settings.

## Phase 5: Files, Search, And Memory

Goal: make the workspace searchable and useful after the moment passes.

- [ ] Attachment upload storage.
- [ ] Document types: CMR, POD, invoice, order confirmation, contract, photo.
- [ ] Full-text search across groups, messages, references, companies, plates,
      and locations.
- [ ] Filters by status, date, assignee, customer, partner, and vehicle.
- [ ] Pinned notes or important messages per shipment.

Definition of done:

- Users can recover a shipment conversation, attached document, or reference
  number quickly.

## Phase 6: Production Hardening

Goal: prepare for external users.

- [ ] Database backups and migration rollback discipline.
- [x] Rate limits for auth and message creation.
- [x] Same-site cookie strategy (`httpOnly`, `sameSite=lax`, `secure` in prod).
- [ ] CSRF protection review for state-changing requests.
- [~] Structured logs (JSON lines) on hot paths + preview-job + socket
  connection events. Error monitoring / metrics export still TODO.
- [ ] CI for build, lint, migrations, and tests.
- [ ] Deployment checklist for Railway.
- [ ] Privacy, retention, and data export decisions.

Definition of done:

- The app can be deployed, monitored, recovered, and updated without
  guesswork.

## Horizontal Scaling (Realtime)

The realtime layer is multi-instance ready. Socket.IO keeps each client's
connection pinned to one API instance, so with more than one instance behind a
load balancer the default in-memory adapter would silently drop cross-instance
events (a `message:new` emitted on instance A never reaches a group member whose
socket is on instance B). The **Socket.IO Redis adapter** removes that limit by
pub/sub-ing every room operation between instances.

What's already wired:

- `@socket.io/redis-adapter` + `redis` clients in `server/src/realtime.ts`,
  enabled automatically when `REDIS_URL` is set, no-op (in-memory) when it isn't.
- All realtime paths go through the adapter, so they're correct across
  instances with zero call-site changes:
  - broadcasts: `io.to(group:<id>).emit(...)` for `message:new` /
    `message:edited` / `message:deleted` / `message:pinned` / `message:unpinned`
    and per-user `group:added`.
  - membership mutations: `subscribeUserToGroup` / `unsubscribeUserFromGroup`
    use `io.in(user:<id>).socketsJoin/Leave(...)`, which the adapter fans out to
    every node, so a user's sockets join/leave the room wherever they live.
  - typing relays use `socket.to(room)` and propagate the same way.

Deployment requirements:

- **Single instance / local dev:** leave `REDIS_URL` unset. No Redis needed.
- **Two or more instances:** `REDIS_URL` is **required** and must point at a
  shared, reachable Redis (`redis://…`, or `rediss://…` for TLS). Set it on
  every instance. Without it, realtime breaks in non-obvious ways (events reach
  only the subset of users on the emitting instance).
- The load balancer does **not** need sticky sessions when the client uses the
  WebSocket transport (the default here). If you ever allow HTTP long-polling
  fallback across instances, enable sticky sessions too.
- Redis is for realtime fan-out only — it holds no durable state, so it can be a
  small managed instance and is safe to restart (clients reconnect, node-redis
  retries with backoff; a Redis outage degrades realtime, not the REST API).
- Production safety: if `REDIS_URL` is set but Redis can't connect, the server
  now **aborts startup in production** rather than silently falling back to the
  in-memory adapter (dev still warns + falls back). With `REDIS_URL` unset in
  production it runs single-instance and logs a warning.
- On boot / connect the server emits structured log events: `redis_adapter_enabled`,
  `redis_adapter_disabled_dev`, `redis_adapter_disabled_prod`,
  `redis_adapter_connect_failed`.

## Production Readiness (status)

Snapshot of the scale/reliability work and what remains.

**Production-ready now**

- **Redis realtime adapter** — multi-instance fan-out via `REDIS_URL`; fails
  loudly in production on connect failure; clear adapter logs. (`realtime.ts`)
- **DB index tuning** — migration `0013_chat_index_tuning.sql`: a full
  `messages (group_id, created_at desc)` index restores index-backed cursor
  pagination (the prior partial index couldn't serve tombstone-inclusive paging),
  and redundant indexes were dropped to cut write amplification.
- **Async preview generation** — `sharp` work is off the request path. The
  upload stores the original, creates the message, responds, then enqueues a job
  (`jobs/previewQueue.ts` → idempotent core `jobs/preview.ts`) that generates the
  preview, updates metadata, and emits `attachment:preview`. Bounded concurrency
  + retries; dedup via `preview_path IS NULL`.
- **Preview backfill** — `npm run backfill:previews` regenerates previews for
  older images that lack them; batched, bounded concurrency, rerun-safe.
- **Hot-path observability** — JSON-line logs: `http_request`
  (method/route/status/durationMs/userId/groupId), `preview_job`
  (status/durationMs), `socket_connect` / `socket_disconnect` (live count). No
  message bodies, cookies, JWTs, or file contents are logged.

**Still remaining**

- **Durable background jobs** — the preview queue is in-process; jobs queued at
  process exit are lost (recoverable via the backfill). `PREVIEW_QUEUE_DRIVER=redis`
  is reserved for a BullMQ-backed durable queue: its worker would call the same
  `runPreviewForAttachment(id)` (no buffer → re-fetches bytes from storage), so
  only `jobs/previewQueue.ts` changes. Today `redis` warns and falls back.
- **Observability depth** — ship logs to an aggregator + error monitoring
  (Sentry) + basic metrics/alerts (p95 latencies, job failure rate).
- **Attachment delivery** — currently every byte is streamed through the API
  (membership-gated, immutable cache headers). At higher volume, move to
  short-lived signed URLs or a CDN in front of the private bucket to offload
  egress from the app instances.

**Migration / index safety**

- The migration runner wraps each file in a transaction, so migrations use plain
  `CREATE INDEX` (a brief write lock). On an **already-large** production table,
  build new indexes out of band with `CREATE INDEX CONCURRENTLY` (which cannot
  run inside a transaction) and record the migration id manually — see the header
  of `0013_chat_index_tuning.sql`. Do not run a blocking index build against a
  large hot table without this step.

## Suggested Next Sprint

The original "first product loop" — sign in, create a group, send messages,
refresh — is now working. The next meaningful loop is the **cross-company
loop**: discover another company, connect, and do business.

1. Connections UI: a pending-requests inbox with accept/decline.
2. Company directory: search companies, view a public profile, send a
   connection request from there.
3. Decide and implement the global email-identity model.
4. Message edit/delete (endpoints + real-time broadcast).
5. Request logging and a scripted auth test harness (closes out Phase 0).

That sprint makes Dispo-chat usable as a network, not just an internal tool.
