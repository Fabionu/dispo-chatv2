import type { Request, Response, NextFunction } from 'express'
import { elapsedMs, log } from '../util/log.js'
import { env } from '../env.js'

// Group routes are /api/groups/:id/... — pull the group id out of the path so
// the hot message/list/send routes carry groupId in their logs. The attachment
// route's :id is an attachment id, not a group, so it's intentionally not
// matched here.
const GROUP_ID_RE = /^\/api\/groups\/([0-9a-fA-F-]{36})\b/

// Per-request structured access log for the API surface. Emits ONE line on
// response finish with method, route, status, duration, and (when known)
// userId + groupId. Deliberately logs no bodies, headers, cookies, or query
// values — only safe metadata. Mount before the routers so it wraps them, but
// after cookie parsing; req.session is populated by requireAuth by the time the
// response finishes, so the userId is available then.
export function requestLog(req: Request, res: Response, next: NextFunction) {
  // Only the API; skip the health probe and (in prod) static asset serving.
  if (!req.path.startsWith('/api/') || req.path === '/api/health') return next()

  const startNs = process.hrtime.bigint()
  res.on('finish', () => {
    const durationMs = elapsedMs(startNs)
    // Same safe metadata fields for both the access line and the slow warning —
    // method/route/status/timing plus ids when known. Still no bodies, headers,
    // cookies, JWTs, message text, or file contents.
    const fields = {
      method: req.method,
      route: req.path,
      status: res.statusCode,
      durationMs,
      userId: req.session?.userId,
      groupId: GROUP_ID_RE.exec(req.path)?.[1],
    }
    log.info('http_request', fields)
    // A request over the configured threshold gets an extra `slow_request`
    // warning so slow endpoints stand out in the logs without grepping timings.
    if (durationMs >= env.SLOW_REQUEST_MS) {
      log.warn('slow_request', fields)
    }
  })
  next()
}
