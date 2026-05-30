import type { Request, Response, NextFunction } from 'express'
import { elapsedMs, log } from '../util/log.js'

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
    log.info('http_request', {
      method: req.method,
      route: req.path,
      status: res.statusCode,
      durationMs: elapsedMs(startNs),
      userId: req.session?.userId,
      groupId: GROUP_ID_RE.exec(req.path)?.[1],
    })
  })
  next()
}
