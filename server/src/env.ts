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

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? '',
  // Postgres connection pool tuning. PG_POOL_MAX caps concurrent DB
  // connections (default 10 — the previous hardcoded value, so behavior is
  // unchanged unless set). The two timeouts are optional: when unset, the
  // node-postgres defaults apply (idleTimeoutMillis 10s, no connection timeout)
  // — so local dev is unaffected.
  PG_POOL_MAX: numberWithDefault('PG_POOL_MAX', 10),
  PG_IDLE_TIMEOUT_MS: optionalNumber('PG_IDLE_TIMEOUT_MS'),
  PG_CONNECTION_TIMEOUT_MS: optionalNumber('PG_CONNECTION_TIMEOUT_MS'),
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
