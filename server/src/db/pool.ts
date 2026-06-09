import pg from 'pg'
import { env, isProd } from '../env.js'
import { log } from '../util/log.js'

// ── TLS ──────────────────────────────────────────────────────────────────────
// Managed Postgres and the Supabase Supavisor pooler require TLS; a local
// database does not. Honor an explicit DATABASE_SSL override, otherwise infer
// from the host: never force TLS for a loopback DB, and enable it for the known
// managed providers + the Supavisor pooler host (*.pooler.supabase.com).
// 'no-verify' (rejectUnauthorized:false) is correct for managed Postgres — we
// trust the host and the cert chain isn't always pinnable.
function useSsl(url: string): boolean {
  if (env.DATABASE_SSL !== undefined) return env.DATABASE_SSL
  if (/@(localhost|127\.0\.0\.1|\[?::1\]?)[:/]/.test(url)) return false
  return /supabase\.(co|com)|pooler\.supabase\.com|render\.com|railway\.app|neon\.tech/.test(url)
}

// ── Pooler detection (informational only) ────────────────────────────────────
// Heuristic for whether DATABASE_URL points at a transaction-mode pooler:
// Supavisor's transaction pooler uses *.pooler.supabase.com on port 6543;
// PgBouncer is conventionally on 6432. Used ONLY for a startup log and a prod
// warning — it never changes how we connect. DATABASE_POOLED overrides it.
function looksPooled(url: string): boolean {
  if (env.DATABASE_POOLED !== undefined) return env.DATABASE_POOLED
  return /pooler\.supabase\.com|:6543(\/|\?|$)|:6432(\/|\?|$)/.test(url)
}

// Build a node-postgres pool for a connection string. Sizing/timeouts come from
// env (see env.ts); `overrides` lets one-shot scripts (migrate/seed) shrink the
// pool and relabel it. Everything here is transaction-pooling-safe: the app runs
// each transaction on a single checked-out client (see withTransaction in
// http.ts) and uses no session-level state (no LISTEN/NOTIFY, advisory locks,
// temp tables, SET, or named prepared statements), so a transaction-mode pooler
// can multiplex these connections.
export function makePool(connectionString: string, overrides: pg.PoolConfig = {}): pg.Pool {
  const p = new pg.Pool({
    connectionString,
    ssl: useSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: env.PG_POOL_MAX,
    // Surface this app in pg_stat_activity / the pooler dashboard.
    application_name: env.PG_APPLICATION_NAME,
    // Keep idle sockets alive through the pooler / load balancer so they aren't
    // silently dropped (a dropped idle socket otherwise resurfaces as an
    // ECONNRESET on the next reuse).
    keepAlive: true,
    ...(env.PG_IDLE_TIMEOUT_MS !== undefined
      ? { idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS }
      : {}),
    ...(env.PG_CONNECTION_TIMEOUT_MS !== undefined
      ? { connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS }
      : {}),
    // Recycle aged connections (reaped on next idle) so none pins a pooler slot
    // or outlives a failover. Off by default → unchanged local-dev behavior.
    ...(env.PG_MAX_LIFETIME_SEC !== undefined
      ? { maxLifetimeSeconds: env.PG_MAX_LIFETIME_SEC }
      : {}),
    // Server-side runaway guards, sent as connection startup parameters. Off by
    // default. (Supavisor forwards these; if your pooler rejects them, prefer
    // `alter role ... set statement_timeout` — see docs/DATABASE_POOLING.md.)
    ...(env.PG_STATEMENT_TIMEOUT_MS !== undefined
      ? { statement_timeout: env.PG_STATEMENT_TIMEOUT_MS }
      : {}),
    ...(env.PG_IDLE_TX_TIMEOUT_MS !== undefined
      ? { idle_in_transaction_session_timeout: env.PG_IDLE_TX_TIMEOUT_MS }
      : {}),
    ...overrides,
  })
  // An idle pooled client can emit 'error' if the backend/pooler drops it
  // (network blip, pooler restart, server-side maxLifetime). Without a listener
  // that becomes an unhandled 'error' event and crashes the process —
  // node-postgres removes the broken client from the pool on its own, so we
  // just log it.
  p.on('error', (err) => {
    log.error('pg_pool_error', { message: String((err as Error)?.message ?? err) })
  })
  return p
}

// The shared runtime pool every request handler uses.
export const pool = makePool(env.DATABASE_URL)

// One-time startup signal so misconfiguration is obvious in the logs: warn if
// production is talking to Postgres directly (no pooler) where it will hit the
// connection ceiling under load; otherwise note the pooled setup + per-instance
// cap. Dev is left quiet.
if (isProd && !looksPooled(env.DATABASE_URL)) {
  log.warn('pg_direct_connection_prod', {
    poolMaxPerInstance: env.PG_POOL_MAX,
    note:
      'DATABASE_URL does not look like a transaction-mode pooler endpoint ' +
      '(expected *.pooler.supabase.com or :6543/:6432). At scale, route through ' +
      'the Supabase pooler / PgBouncer in transaction mode so (pool_max × instances) ' +
      "doesn't exhaust Postgres max_connections. See docs/DATABASE_POOLING.md.",
  })
} else if (looksPooled(env.DATABASE_URL)) {
  log.info('pg_pooled_connection', {
    poolMaxPerInstance: env.PG_POOL_MAX,
    maxLifetimeSec: env.PG_MAX_LIFETIME_SEC ?? null,
  })
}

export type DbClient = pg.PoolClient
