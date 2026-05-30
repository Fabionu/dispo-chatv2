import { env } from '../env.js'
import { log } from '../util/log.js'
import { runPreviewForAttachment } from './preview.js'

// ── Attachment preview queue (driver abstraction) ─────────────────────────
//
// Preview generation (sharp decode → downscale → WebP encode) is CPU/memory
// heavy, so it runs OUT of the upload request: the route stores the original,
// creates the message, responds, then enqueues a job here. The actual work
// lives in runPreviewForAttachment (./preview.ts) so every driver — and the
// backfill script — share one idempotent implementation.
//
// Driver selection (env.PREVIEW_QUEUE_DRIVER):
//   • 'memory' (default): the in-process queue below. Bounded concurrency +
//     retries; fast (reuses the upload buffer) but NOT durable — jobs queued
//     when the process exits are lost (the bubble simply keeps using the
//     original; the backfill script can recover them later).
//   • 'redis': reserved for a durable BullMQ-backed queue (see ROADMAP). Not
//     shipped yet, so requesting it logs a one-time warning and falls back to
//     'memory' — we never silently stop generating previews.
//
// Swapping in the durable driver later only touches this file: enqueuePreviewJob
// would push { attachmentId } onto a BullMQ queue whose worker calls
// runPreviewForAttachment(attachmentId) (no buffer → it re-fetches the bytes).

const MAX_CONCURRENT = 2
const MAX_ATTEMPTS = 2

type Job = { attachmentId: string; buffer?: Buffer; attempts: number }

export type PreviewJobInput = { attachmentId: string; buffer?: Buffer }

const queue: Job[] = []
let active = 0
let warnedRedisFallback = false

// Non-blocking: enqueue and return immediately so request handlers never await
// preview work.
export function enqueuePreviewJob(input: PreviewJobInput): void {
  if (env.PREVIEW_QUEUE_DRIVER === 'redis' && !warnedRedisFallback) {
    warnedRedisFallback = true
    log.warn('preview_queue_driver_fallback', {
      requested: 'redis',
      using: 'memory',
      note: 'durable Redis preview queue not enabled in this build',
    })
  }
  queue.push({ attachmentId: input.attachmentId, buffer: input.buffer, attempts: 0 })
  pump()
}

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    active += 1
    void processJob(job).finally(() => {
      active -= 1
      pump()
    })
  }
}

async function processJob(job: Job): Promise<void> {
  try {
    await runPreviewForAttachment(job.attachmentId, { buffer: job.buffer })
  } catch (err) {
    // Transient failure (storage hiccup, etc.). Retry a bounded number of
    // times; drop the buffer on retry so memory isn't pinned — the core
    // re-fetches the bytes from storage. A missing preview is non-fatal.
    const message = String((err as Error)?.message ?? err)
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      queue.push({ attachmentId: job.attachmentId, attempts: job.attempts + 1 })
      log.warn('preview_job', { attachmentId: job.attachmentId, status: 'retry', attempt: job.attempts + 1, message })
      pump()
    } else {
      log.error('preview_job', { attachmentId: job.attachmentId, status: 'failed', message })
    }
  }
}
