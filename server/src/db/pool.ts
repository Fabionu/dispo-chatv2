import pg from 'pg'
import { env } from '../env.js'

// Supabase requires SSL. The 'no-verify' mode skips cert validation, which is
// fine for managed Postgres — we trust the host.
const needsSsl = /supabase\.co|render\.com|railway\.app|neon\.tech/.test(env.DATABASE_URL)

// Pool sizing/timeouts come from env (see env.ts). max defaults to 10 (the
// previous hardcoded value); the timeouts are only passed through when set, so
// an unset env leaves node-postgres' own defaults in place.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: env.PG_POOL_MAX,
  ...(env.PG_IDLE_TIMEOUT_MS !== undefined
    ? { idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS }
    : {}),
  ...(env.PG_CONNECTION_TIMEOUT_MS !== undefined
    ? { connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS }
    : {}),
})

export type DbClient = pg.PoolClient
