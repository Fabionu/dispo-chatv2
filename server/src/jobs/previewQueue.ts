import { env, isProd } from '../env.js'
import { log } from '../util/log.js'
import { getRedisClient } from '../redis.js'
import { runPreviewForAttachment } from './preview.js'

// ── Attachment preview queue (driver abstraction) ─────────────────────────
//
// Preview generation (sharp decode → downscale → WebP encode) is CPU/memory
// heavy, so it runs OUT of the upload request: the route stores the original,
// creates the message, responds, then enqueues a job here. The actual work
// lives in runPreviewForAttachment (./preview.ts) so every driver — and the
// backfill script — share one idempotent implementation.
//
// Driver selection (env.PREVIEW_QUEUE_DRIVER), resolved once at startup:
//   • 'memory' (default): in-process queue. Bounded concurrency + retries; fast
//     (reuses the upload buffer) but NOT durable — jobs queued when the process
//     exits are lost (the bubble keeps using the original; the backfill script
//     can recover them later).
//   • 'redis': durable, crash-safe Redis queue using a WAITING + PROCESSING list
//     ack pattern (see below). Jobs carry ONLY { attachmentId, attempts } — never
//     image bytes, so we don't park large buffers in Redis; the worker re-fetches
//     bytes from storage via runPreviewForAttachment.
//
// Crash safety (redis): a worker atomically MOVES a job from WAITING to
// PROCESSING (LMOVE), runs it, and only removes it from PROCESSING (LREM) on
// success ("ack"). On failure it removes the in-flight copy and either re-queues
// to WAITING with attempts+1 (retry) or drops it (final failure). If the process
// crashes between the move and the ack, the job is left in PROCESSING and is
// recovered back into WAITING at the next startup — so nothing is silently lost.
//
// Production safety: PREVIEW_QUEUE_DRIVER=redis NEVER silently falls back to
// memory in production — if Redis is unavailable, initPreviewQueue throws and
// aborts startup. In dev it warns and uses memory so local work isn't blocked.
//
// PRODUCTION TODO (separate the workers from the API): today the redis workers
// run IN the API process (startRedis() is called from initPreviewQueue at API
// startup). Preview work is CPU/memory heavy (Sharp decode → downscale → WebP
// encode, plus PDF rasterization), so under load it competes with live request
// handling on the same event loop / CPU. The durable redis driver is already
// designed for this split — jobs carry only { attachmentId } and the worker
// re-fetches bytes from storage — so the next step is to run the workers as a
// SEPARATE process (a dedicated worker entrypoint that calls startRedis() but
// mounts no HTTP server, scaled independently) and have the API only ENQUEUE
// (never start workers). The memory driver stays in-process for local dev.

const MAX_CONCURRENT = 2
const MAX_ATTEMPTS = 2
const WAITING_KEY = 'preview:jobs'
const PROCESSING_KEY = 'preview:processing'
const POLL_MS = 1000
const RECOVERY_LIMIT = 10_000 // safety bound on startup drain

export type PreviewJobInput = { attachmentId: string; buffer?: Buffer }

// Effective driver after init (the requested driver may downgrade to memory in
// dev when Redis is unavailable).
let driver: 'memory' | 'redis' = 'memory'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errMsg = (err: unknown) => String((err as Error)?.message ?? err)

// ── Memory driver ──────────────────────────────────────────────────────────
type MemJob = { attachmentId: string; buffer?: Buffer; attempts: number }
const memQueue: MemJob[] = []
let memActive = 0

function memPump(): void {
  while (memActive < MAX_CONCURRENT && memQueue.length > 0) {
    const job = memQueue.shift()!
    memActive += 1
    void memProcess(job).finally(() => {
      memActive -= 1
      memPump()
    })
  }
}

async function memProcess(job: MemJob): Promise<void> {
  try {
    await runPreviewForAttachment(job.attachmentId, { buffer: job.buffer })
  } catch (err) {
    // Transient failure (storage hiccup, etc.). Retry a bounded number of times;
    // drop the buffer on retry so memory isn't pinned — the core re-fetches the
    // bytes from storage. A missing preview is non-fatal.
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      memQueue.push({ attachmentId: job.attachmentId, attempts: job.attempts + 1 })
      log.warn('preview_job', { attachmentId: job.attachmentId, status: 'retry', attempt: job.attempts + 1, message: errMsg(err) })
      memPump()
    } else {
      log.error('preview_job', { attachmentId: job.attachmentId, status: 'failed', message: errMsg(err) })
    }
  }
}

// ── Redis driver (WAITING + PROCESSING ack pattern) ──────────────────────────
type RedisClient = NonNullable<ReturnType<typeof getRedisClient>>
let workersStarted = false

// Drain anything stuck in PROCESSING (left by a crash mid-job) back into WAITING
// so it gets retried. Idempotent previews make a re-run harmless. Runs once at
// startup, before workers begin claiming.
async function recoverProcessing(client: RedisClient): Promise<number> {
  let moved = 0
  for (; moved < RECOVERY_LIMIT; ) {
    const raw = await client.lMove(PROCESSING_KEY, WAITING_KEY, 'RIGHT', 'LEFT').catch(() => null)
    if (!raw) break
    moved += 1
  }
  return moved
}

function startRedis(): void {
  if (workersStarted) return
  workersStarted = true
  void (async () => {
    const client = getRedisClient()
    if (!client) return
    try {
      const recovered = await recoverProcessing(client)
      if (recovered > 0) log.info('preview_queue_recovered', { jobs: recovered })
    } catch (err) {
      log.error('preview_queue_recover_failed', { message: errMsg(err) })
    }
    for (let i = 0; i < MAX_CONCURRENT; i++) void redisWorker()
  })()
}

async function redisWorker(): Promise<void> {
  // Long-lived loop. LMOVE atomically claims a job (WAITING tail → PROCESSING
  // head) so concurrent workers never pick up the same one and a crash leaves a
  // recoverable copy in PROCESSING.
  for (;;) {
    const client = getRedisClient()
    if (!client) {
      await sleep(POLL_MS)
      continue
    }
    let raw: string | null = null
    try {
      raw = await client.lMove(WAITING_KEY, PROCESSING_KEY, 'RIGHT', 'LEFT')
    } catch (err) {
      log.error('preview_queue_claim', { message: errMsg(err) })
      await sleep(POLL_MS)
      continue
    }
    if (!raw) {
      await sleep(POLL_MS)
      continue
    }
    await handleClaimed(client, raw)
  }
}

async function handleClaimed(client: RedisClient, raw: string): Promise<void> {
  let job: { attachmentId: string; attempts?: number }
  try {
    job = JSON.parse(raw)
  } catch {
    // Unparseable entry — drop it from PROCESSING so it can't wedge the queue.
    await client.lRem(PROCESSING_KEY, 1, raw).catch(() => {})
    return
  }
  try {
    // No buffer in Redis — the worker re-fetches the bytes from storage.
    await runPreviewForAttachment(job.attachmentId, {})
    // Ack: remove the in-flight copy only after success.
    await client.lRem(PROCESSING_KEY, 1, raw)
  } catch (err) {
    const attempts = (job.attempts ?? 0) + 1
    const message = errMsg(err)
    // Remove the in-flight copy first, then decide retry vs final failure.
    await client.lRem(PROCESSING_KEY, 1, raw).catch(() => {})
    if (attempts < MAX_ATTEMPTS) {
      await client
        .lPush(WAITING_KEY, JSON.stringify({ attachmentId: job.attachmentId, attempts }))
        .catch(() => {})
      log.warn('preview_job', { attachmentId: job.attachmentId, status: 'retry', attempt: attempts, message })
    } else {
      log.error('preview_job', { attachmentId: job.attachmentId, status: 'failed', message })
    }
  }
}

// ── Init + enqueue ───────────────────────────────────────────────────────────

// Resolve the driver at startup and start workers. Call once, after initRedis().
export function initPreviewQueue(): void {
  if (env.PREVIEW_QUEUE_DRIVER === 'redis') {
    if (getRedisClient()) {
      driver = 'redis'
      startRedis()
      log.info('preview_queue', { driver: 'redis', concurrency: MAX_CONCURRENT, durable: true })
      return
    }
    // Requested redis but no client available.
    if (isProd) {
      throw new Error(
        'PREVIEW_QUEUE_DRIVER=redis but Redis is not available; aborting startup ' +
          '(refusing to fall back to the in-memory preview queue in production).',
      )
    }
    driver = 'memory'
    log.warn('preview_queue', {
      driver: 'memory',
      requested: 'redis',
      note: 'Redis unavailable — using in-memory queue (dev only)',
    })
    return
  }
  driver = 'memory'
  log.info('preview_queue', { driver: 'memory', durable: false })
}

// Non-blocking: enqueue and return immediately so request handlers never await
// preview work. Redis path stores ONLY the id (worker re-fetches bytes); memory
// path keeps the upload buffer to skip a re-download.
export function enqueuePreviewJob(input: PreviewJobInput): void {
  if (driver === 'redis') {
    const client = getRedisClient()
    if (client) {
      void client
        .lPush(WAITING_KEY, JSON.stringify({ attachmentId: input.attachmentId, attempts: 0 }))
        .catch((err) => log.error('preview_enqueue', { attachmentId: input.attachmentId, message: errMsg(err) }))
      return
    }
    // Defensive: driver resolved to redis but the client vanished. Prod aborts
    // at init, so this is a dev-only edge — fall through to memory.
  }
  memQueue.push({ attachmentId: input.attachmentId, buffer: input.buffer, attempts: 0 })
  memPump()
}
