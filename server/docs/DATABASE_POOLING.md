# Database connection pooling (transaction mode)

For large-scale, multi-tenant, high-concurrency use, the app must reach Postgres
through a **transaction-mode pooler** (Supabase Supavisor, or PgBouncer). This
doc explains why, what to set, and how to verify it. **No code change is needed
to switch** — it's driven entirely by environment variables.

## Why

Each app instance opens its own pool of up to `PG_POOL_MAX` connections. Managed
Postgres has a low hard ceiling on *real* backend connections (Supabase: tens to
low hundreds depending on plan). The ceiling that matters is:

```
total backend connections ≈ PG_POOL_MAX × number of app instances
```

Run 8 instances at the default `max: 10` and you've consumed 80 backend
connections before serving a single concurrent spike — Postgres falls over from
connection exhaustion long before CPU is the limit. A transaction-mode pooler
multiplexes many client connections onto a small set of backend connections
(a connection is borrowed only for the duration of each transaction), so you can
scale instances out without scaling backend connections up.

## Compatibility (already audited — safe)

Transaction pooling forbids state that outlives a single transaction. This app
was audited and uses **none** of it:

- Every multi-statement write runs on **one checked-out client** via
  `withTransaction` (`src/http.ts`) — `BEGIN … COMMIT/ROLLBACK … release`.
- **No** `LISTEN`/`NOTIFY`, advisory locks, temp tables, session-level `SET`, or
  `WITH HOLD` cursors.
- **No named/server-side prepared statements** (node-postgres uses the unnamed
  extended protocol per query, which is fine in transaction mode).

So the app is transaction-pooling-safe as-is. **Realtime fan-out already runs on
Redis** (Socket.IO adapter + presence), independent of the DB pooler.

## What to set (Supabase Supavisor)

Supabase exposes three endpoints for the same database:

| Purpose                    | Host / port                              |
| -------------------------- | ---------------------------------------- |
| Direct                     | `db.<ref>.supabase.co:5432`              |
| Session pooler             | `<ref>.pooler.supabase.com:5432`         |
| **Transaction pooler**     | `<ref>.pooler.supabase.com:6543`         |

Set the runtime app to the **transaction pooler (6543)** and migrations to the
**direct (5432)** connection:

```bash
# Runtime: route all request/socket DB traffic through the transaction pooler.
DATABASE_URL="postgresql://postgres.<ref>:<pw>@<ref>.pooler.supabase.com:6543/postgres"

# Migrations + seed: DDL (incl. CREATE INDEX CONCURRENTLY) needs a direct,
# un-pooled connection. The migrate/seed scripts use this automatically.
DIRECT_DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"

# Per-instance pool cap. Keep modest and scale OUT (more instances), not up.
PG_POOL_MAX=15

# Reap idle app→pooler sockets so they don't hold pooler client slots.
PG_IDLE_TIMEOUT_MS=10000

# Fail fast instead of hanging if the pooler is saturated/unreachable.
PG_CONNECTION_TIMEOUT_MS=10000

# Recycle aged connections (avoids pinning a pooler slot / surviving failover).
PG_MAX_LIFETIME_SEC=600

# Runaway guards (optional but recommended — see note below).
PG_STATEMENT_TIMEOUT_MS=15000
PG_IDLE_TX_TIMEOUT_MS=30000
```

`DATABASE_SSL` and `DATABASE_POOLED` are available as explicit overrides but are
normally unnecessary — TLS and pooler-detection are inferred from the host/port.

## Sizing for tens of thousands of concurrent users

The pooler does the heavy multiplexing, so the app pool stays small:

- **`PG_POOL_MAX` 10–20 per instance.** DB work per request is short
  (indexed keyset reads; small transactional writes), so a handful of
  connections per instance saturate easily. Bigger pools just queue at the
  pooler.
- **Watch the pooler, not the app.** The number to keep under Postgres
  `max_connections` is the pooler's *backend* (server-side) pool — set on the
  Supabase pooler config / PgBouncer `default_pool_size`. Size that to your plan
  (e.g. 15–40 backend connections), and let thousands of client connections fan
  in front of it.
- **Scale by adding instances**, not by raising `PG_POOL_MAX`.

### Runaway-query guards

`PG_STATEMENT_TIMEOUT_MS` / `PG_IDLE_TX_TIMEOUT_MS` are sent as connection
startup parameters. Supavisor forwards them. If a pooler ever rejects them as
unsupported startup parameters, set them on the **database role** instead (the
most pooler-robust place), and leave the env vars unset:

```sql
alter role postgres set statement_timeout = '15s';
alter role postgres set idle_in_transaction_session_timeout = '30s';
```

## PgBouncer (self-hosted alternative)

```ini
[databases]
app = host=<pg-host> port=5432 dbname=postgres

[pgbouncer]
pool_mode = transaction          ; required — the whole point
default_pool_size = 20            ; backend connections per (db,user)
max_client_conn = 10000          ; client side can be very large
server_idle_timeout = 600
; node-postgres uses the unnamed extended protocol, so prepared-statement
; pooling needs PgBouncer >= 1.21 (older versions: keep this default/off).
```

Point `DATABASE_URL` at PgBouncer (transaction mode) and `DIRECT_DATABASE_URL`
at Postgres directly.

## Verify

1. **Startup log** — with a pooled `DATABASE_URL` you should see
   `pg_pooled_connection`. A direct connection in production logs the
   `pg_direct_connection_prod` warning instead.
2. **Migrations** — `npm run migrate` connects via `DIRECT_DATABASE_URL`
   (app_name `dispo-migrate`); confirm it still applies cleanly.
3. **`pg_stat_activity`** — backend connections show `application_name =
   dispo-api`; their count should track the pooler's backend pool size, not the
   sum across all app instances.
4. **Load** — backend connection count stays flat as you add instances; only the
   pooler's *client* connection count rises.

## Rollback

Set `DATABASE_URL` back to the direct connection and unset `DIRECT_DATABASE_URL`.
No code change required.
