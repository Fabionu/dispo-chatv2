import pg from 'pg'
import { env } from '../env.js'

// Supabase requires SSL. The 'no-verify' mode skips cert validation, which is
// fine for managed Postgres — we trust the host.
const needsSsl = /supabase\.co|render\.com|railway\.app|neon\.tech/.test(env.DATABASE_URL)

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
})

export type DbClient = pg.PoolClient
