import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? '',
  // Supabase Storage backs attachment files (durable + shared across
  // environments, unlike the old per-instance local disk which Railway wipes
  // on every redeploy). The service-role key is server-only — the bucket is
  // private and this API is the sole door to its bytes.
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'attachments',
}

export const isProd = env.NODE_ENV === 'production'
