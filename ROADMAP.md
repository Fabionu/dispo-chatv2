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
- [ ] Structured logs and error monitoring.
- [ ] CI for build, lint, migrations, and tests.
- [ ] Deployment checklist for Railway.
- [ ] Privacy, retention, and data export decisions.

Definition of done:

- The app can be deployed, monitored, recovered, and updated without
  guesswork.

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
