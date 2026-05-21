import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { pool, type DbClient } from './db/pool.js'

// A failure that maps cleanly to an HTTP response. Throw it from anywhere in
// a request's async path — including inside withTransaction — and the central
// error handler turns it into `res.status(status).json({ error: code, ...extra })`.
// `extra` carries the occasional non-error field a response needs, e.g.
// { connectionId } on 'already_connected' or { status } on 'not_pending'.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'HttpError'
  }
}

// Express 4 does not catch errors thrown from async handlers — they surface as
// unhandled promise rejections. Wrapping a handler funnels any rejection into
// next(), i.e. to the central error middleware.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// Runs `fn` inside a BEGIN/COMMIT. Any throw (including HttpError) triggers a
// ROLLBACK; the client is always released. Returns whatever `fn` returns.
// This replaces the hand-written try/catch/rollback/release in every handler
// that touches multiple rows.
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Central error middleware. Mount last, after all routes. HttpError becomes
// its declared status; anything else is an unexpected fault → logged + 500.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, ...(err.extra ?? {}) })
  }
  console.error('unhandled error:', err)
  res.status(500).json({ error: 'server_error' })
}
