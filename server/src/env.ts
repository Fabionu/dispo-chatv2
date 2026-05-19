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
}

export const isProd = env.NODE_ENV === 'production'
