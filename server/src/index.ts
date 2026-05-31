import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, isProd } from './env.js'
import { authRouter } from './routes/auth.js'
import { groupsRouter } from './routes/groups.js'
import { connectionsRouter } from './routes/connections.js'
import { workspaceRouter } from './routes/workspace.js'
import { directoryRouter } from './routes/directory.js'
import { attachmentsRouter } from './routes/attachments.js'
import { profileRouter, usersRouter } from './routes/profile.js'
import { companyProfileRouter } from './routes/companyProfile.js'
import { initRealtime } from './realtime.js'
import { initRedis } from './redis.js'
import { initPreviewQueue } from './jobs/previewQueue.js'
import { initRateLimiters } from './middleware/rateLimit.js'
import { errorHandler } from './http.js'
import { requestLog } from './middleware/requestLog.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()

// Behind Railway's proxy, X-Forwarded-* headers are trustworthy. Tell Express
// to honour them so rate-limit keys hash the real client IP, not the proxy.
app.set('trust proxy', 1)

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
}

// Structured access log for the API surface (route/status/duration/userId/
// groupId). Mounted before the routers so it wraps them; reads req.session on
// finish, by which point requireAuth has populated it. Logs no bodies/headers.
app.use(requestLog)

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/connections', connectionsRouter)
app.use('/api/workspace', workspaceRouter)
app.use('/api/directory', directoryRouter)
app.use('/api/attachments', attachmentsRouter)
app.use('/api/profile', profileRouter)
app.use('/api/company-profile', companyProfileRouter)
app.use('/api/users', usersRouter)

// In production, serve the built frontend from web/dist.
if (isProd) {
  const webDist = resolve(__dirname, '../../web/dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('*', (_req, res) => {
      res.sendFile(join(webDist, 'index.html'))
    })
  } else {
    console.warn(`web/dist not found at ${webDist} — frontend won't be served`)
  }
}

// Central error handler — must be registered last. asyncHandler funnels every
// thrown error here: HttpError becomes its declared status, anything else 500.
app.use(errorHandler)

// Connect the shared Redis command client first (rate-limit store + preview
// queue depend on it). In production this aborts startup if REDIS_URL is set
// but unreachable — we never serve on a degraded distributed setup.
await initRedis()
// Build limiters now that Redis status is known — Redis store only when the
// command client is actually connected, otherwise in-memory.
initRateLimiters()
// Resolve the preview-queue driver and start workers (redis) — also aborts in
// production if PREVIEW_QUEUE_DRIVER=redis but Redis is unavailable.
initPreviewQueue()

// Wrap Express in a Node HTTP server so Socket.IO can attach to the same port.
const httpServer = createServer(app)
await initRealtime(httpServer)

httpServer.listen(env.PORT, () => {
  console.log(`api + ws listening on http://localhost:${env.PORT}`)
})
