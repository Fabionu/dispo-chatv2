import { pool } from '../db/pool.js'
import { runPreviewForAttachment, type PreviewOutcome } from './preview.js'
import { log } from '../util/log.js'

// One-off / repeatable maintenance job: generate previews for image attachments
// that predate preview support (preview_path NULL). Reuses the same idempotent
// core as the live queue, so it's safe to run repeatedly and concurrently with
// normal traffic.
//
// Run:
//   npm run backfill:previews                # one batch (default 500)
//   BACKFILL_BATCH=2000 npm run backfill:previews
//   BACKFILL_CONCURRENCY=5 npm run backfill:previews
//
// It processes at most BACKFILL_BATCH rows per invocation; rerun until it
// reports `candidates: 0`. Animated GIFs are excluded (no static preview is
// useful); corrupt/undecodable images come back 'unsupported' and are simply
// left on the original. Known-missing originals (missing = true) are skipped.
//
// Safe to rerun: it only selects preview_path IS NULL and the core re-checks
// (and guards the UPDATE with) preview_path IS NULL, so a row a concurrent
// uploader just filled won't be double-processed.

const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH ?? 500))
const CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY ?? 3))

async function main() {
  const { rows } = await pool.query<{ id: string }>(
    `select a.id
       from attachments a
      where a.preview_path is null
        and a.missing = false
        and a.mime_type like 'image/%'
        and a.mime_type <> 'image/gif'
      order by a.created_at asc
      limit $1`,
    [BATCH],
  )

  log.info('backfill_start', { candidates: rows.length, batch: BATCH, concurrency: CONCURRENCY })

  const counts: Record<string, number> = {}
  let cursor = 0

  async function worker() {
    while (cursor < rows.length) {
      const id = rows[cursor++].id
      try {
        const outcome: PreviewOutcome = await runPreviewForAttachment(id)
        counts[outcome] = (counts[outcome] ?? 0) + 1
      } catch (err) {
        counts.error = (counts.error ?? 0) + 1
        log.error('backfill_item_failed', {
          attachmentId: id,
          message: String((err as Error)?.message ?? err),
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))

  log.info('backfill_done', { processed: rows.length, ...counts })
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
