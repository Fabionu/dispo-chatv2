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
import { initRealtime } from './realtime.js'
import { errorHandler } from './http.js'

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

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/connections', connectionsRouter)
app.use('/api/workspace', workspaceRouter)

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

// Wrap Express in a Node HTTP server so Socket.IO can attach to the same port.
const httpServer = createServer(app)
await initRealtime(httpServer)

httpServer.listen(env.PORT, () => {
  console.log(`api + ws listening on http://localhost:${env.PORT}`)
})
