import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, isProd } from './env.js'
import { authRouter } from './routes/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)

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

app.listen(env.PORT, () => {
  console.log(`api listening on http://localhost:${env.PORT}`)
})
