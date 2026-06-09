import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

// Numeric env var with a default. Unset/blank, non-numeric (NaN), or a
// non-positive value all fall back to `fallback` — so a typo'd or zero/negative
// override can never silently produce a NaN/0 config. A valid positive number
// is used as-is.
function numberWithDefault(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Optional numeric env var (no default). Unset/blank → undefined (so callers can
// fall back to a library default); a non-numeric (NaN) or non-positive value is
// likewise treated as unset rather than silently coerced to NaN/0.
function optionalNumber(name: string): number | undefined {
  const v = process.env[name]
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// Optional boolean env var (no default). Accepts 1/true/yes/on and 0/false/no/off
// (case-insensitive). Unset/blank or unrecognised → undefined, so callers can
// fall back to their own inference rather than a forced false.
function optionalBoolean(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase()
  if (v === undefined || v === '') return undefined
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return undefined
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  // Direct (non-pooled) Postgres URL for schema migrations and the seed script.
  // DDL — and especially `create index concurrently` — is incompatible with a
  // transaction-mode pooler, so when DATABASE_URL points at the Supabase pooler
  // (:6543), point this at the direct connection (:5432). Unset → migrations use
  // DATABASE_URL (correct when that's already a direct/un-pooled connection).
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL ?? '',
  JWT_SECRET: required('JWT_SECRET'),
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? '',
  // ── Postgres connection pool tuning ────────────────────────────────────────
  // PG_POOL_MAX caps the connections EACH app instance opens (default 10 — the
  // previous hardcoded value, so behavior is unchanged unless set). Behind a
  // transaction-mode pooler (Supabase Supavisor / PgBouncer) this is the count
  // PER INSTANCE *to the pooler*, which multiplexes them onto far fewer real
  // Postgres connections — so the number that must stay under Postgres'
  // max_connections is (PG_POOL_MAX × instance count), measured at the pooler,
  // not here. Keep this modest (10–20) and scale out instances, not this value.
  PG_POOL_MAX: numberWithDefault('PG_POOL_MAX', 10),
  PG_IDLE_TIMEOUT_MS: optionalNumber('PG_IDLE_TIMEOUT_MS'),
  PG_CONNECTION_TIMEOUT_MS: optionalNumber('PG_CONNECTION_TIMEOUT_MS'),
  // Recycle a pooled connection once it has been open this long (it's reaped on
  // its next idle moment). Stops a connection from pinning a pooler server slot
  // indefinitely or outliving a failover/DNS change. Unset → node-postgres keeps
  // connections indefinitely (fine for local dev). Recommended in prod, e.g. 600.
  PG_MAX_LIFETIME_SEC: optionalNumber('PG_MAX_LIFETIME_SEC'),
  // Server-side guards sent as connection startup parameters. A runaway query or
  // an abandoned open transaction otherwise holds a pooled connection, and behind
  // a transaction pooler that starves every other instance sharing the upstream
  // pool. Unset → no limit (unchanged). Recommended in prod (e.g. 15000 / 30000),
  // but the most pooler-robust place is the DB role: `alter role <user> set
  // statement_timeout = '15s'` (see docs/DATABASE_POOLING.md).
  PG_STATEMENT_TIMEOUT_MS: optionalNumber('PG_STATEMENT_TIMEOUT_MS'),
  PG_IDLE_TX_TIMEOUT_MS: optionalNumber('PG_IDLE_TX_TIMEOUT_MS'),
  // Identifies this app's connections in pg_stat_activity and the pooler
  // dashboard — invaluable when diagnosing connection pressure across instances.
  PG_APPLICATION_NAME: process.env.PG_APPLICATION_NAME ?? 'dispo-api',
  // Force-enable/disable TLS to Postgres, overriding the host-based inference in
  // db/pool.ts. Unset → inferred (managed hosts + the Supabase pooler use TLS;
  // localhost does not). Set DATABASE_SSL=false only for a non-TLS local DB on a
  // host the inference would otherwise treat as managed.
  DATABASE_SSL: optionalBoolean('DATABASE_SSL'),
  // Override the "are we behind a pooler?" inference used only for the startup
  // log + the prod warning (never changes connection behavior). Unset → inferred
  // from the host/port (*.pooler.supabase.com, :6543, :6432).
  DATABASE_POOLED: optionalBoolean('DATABASE_POOLED'),
  // Above this many milliseconds an API request is additionally logged as a
  // `slow_request` warning (on top of the normal http_request line). Default
  // 1000ms. Lower it to surface more, raise it to quiet the warnings.
  SLOW_REQUEST_MS: numberWithDefault('SLOW_REQUEST_MS', 1000),
  // Optional. When set, Socket.IO uses the Redis adapter so realtime events
  // (and room joins/leaves) propagate across every API instance — required for
  // running more than one instance behind a load balancer. Unset = single
  // -instance in-memory adapter, which is correct for local dev.
  REDIS_URL: process.env.REDIS_URL ?? '',
  // Preview job backend. 'memory' = in-process queue (default; durable only for
  // the life of the process). 'redis' = durable, crash-safe Redis queue
  // (WAITING + PROCESSING ack pattern; see jobs/previewQueue.ts). When 'redis'
  // is requested but Redis is unavailable, startup aborts in production and
  // falls back to the in-memory queue in dev.
  PREVIEW_QUEUE_DRIVER: process.env.PREVIEW_QUEUE_DRIVER ?? 'memory',
  // Supabase Storage backs attachment files (durable + shared across
  // environments, unlike the old per-instance local disk which Railway wipes
  // on every redeploy). The service-role key is server-only — the bucket is
  // private and this API is the sole door to its bytes.
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'attachments',
  // ── Amazon Location Service (optional vehicle tracking) ────────────────────
  // When BOTH AWS_REGION and AWS_LOCATION_TRACKER_NAME are set, the location
  // endpoints read the latest device position from the tracker. AWS credentials
  // come from the standard AWS provider chain (env AWS_ACCESS_KEY_ID /
  // AWS_SECRET_ACCESS_KEY, IAM role, etc.) — never hardcoded here. Left unset =
  // the feature is disabled and the endpoint returns `location_not_configured`,
  // so existing deployments are unaffected.
  AWS_REGION: process.env.AWS_REGION ?? '',
  AWS_LOCATION_TRACKER_NAME: process.env.AWS_LOCATION_TRACKER_NAME ?? '',
}

export const isProd = env.NODE_ENV === 'production'
