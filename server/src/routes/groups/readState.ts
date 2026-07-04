import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { asyncHandler } from '../../http.js'
import { getIO, roomForGroup, roomForUser } from '../../realtime.js'

export const readStateRouter = Router()

// ── POST /api/groups/:id/read ────────────────────────────────────────────
// Mark the group read up to a given message timestamp (or now). Lightweight.
const readSchema = z.object({
  upTo: z.string().datetime().optional(),
})

readStateRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const parsed = readSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const at = parsed.data.upTo ?? new Date().toISOString()
    const groupId = req.params.id

    const { rows } = await pool.query<{ last_read_at: string }>(
      `update group_members
          set last_read_at = greatest(coalesce(last_read_at, 'epoch'::timestamptz), $1),
              -- Denormalized counters (migration 0020): the client marks read up
              -- to the latest message, so clearing both to 0 matches the unread
              -- definition (nothing after last_read_at remains). last_read_at is
              -- still the source of truth for per-message read receipts.
              unread_count = 0,
              unread_mention_count = 0
        where group_id = $2 and user_id = $3
        returning last_read_at`,
      [at, groupId, userId],
    )
    if (rows.length === 0) return res.status(403).json({ error: 'not_a_member' })

    // Tell the rest of the group room that this member's read marker advanced,
    // so their sent-message checkmarks update live without anyone refetching the
    // conversation or the member list. One tiny event per read, not per message.
    // (Unchanged — per-message read receipts depend on this event.)
    const lastReadAt = rows[0].last_read_at
    const io = getIO()
    io.to(roomForGroup(groupId)).emit('group:read', { groupId, userId, lastReadAt })
    // Clear the sidebar unread badge on this user's OTHER tabs/devices live: the
    // acting tab already cleared via onRead, but the others only learn here. The
    // counters were just reset to 0 above, so 0/0 is authoritative.
    io.to(roomForUser(userId)).emit('group:unread', {
      groupId,
      unreadCount: 0,
      unreadMentionCount: 0,
    })

    res.json({ ok: true, lastReadAt })
  }),
)

// ── POST /api/groups/:id/unread ──────────────────────────────────────────
// Mark the conversation UNREAD for the caller (the sidebar "Mark as unread"
// action) — a personal flag, the inverse of /read. We only bump this user's
// denormalized unread_count to at least 1 so the badge shows and persists; we
// deliberately DON'T move last_read_at backwards, so the per-message read
// receipts other members already saw aren't retracted (it's a personal reminder,
// not a claim the message was un-seen). Opening the conversation clears it again
// via /read. No-op safe when the group has no messages.
readStateRouter.post(
  '/:id/unread',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows } = await pool.query<{ unread_count: number; unread_mention_count: number }>(
      `update group_members gm
          set unread_count = greatest(gm.unread_count, 1)
        where gm.group_id = $1 and gm.user_id = $2
          and exists (
            select 1 from messages m
             where m.group_id = $1 and m.kind = 'user' and m.deleted_at is null
          )
        returning gm.unread_count, gm.unread_mention_count`,
      [groupId, userId],
    )
    // Either not a member, or the group has no user messages to be unread about.
    // Both are safe no-ops from the caller's perspective; report the current state.
    if (rows.length === 0) {
      const { rows: member } = await pool.query(
        'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
        [groupId, userId],
      )
      if (member.length === 0) return res.status(403).json({ error: 'not_a_member' })
      return res.json({ ok: true, unreadCount: 0, unreadMentionCount: 0 })
    }

    const { unread_count, unread_mention_count } = rows[0]
    // Sync the caller's OTHER tabs/devices so the badge appears everywhere.
    getIO().to(roomForUser(userId)).emit('group:unread', {
      groupId,
      unreadCount: unread_count,
      unreadMentionCount: unread_mention_count,
    })
    res.json({ ok: true, unreadCount: unread_count, unreadMentionCount: unread_mention_count })
  }),
)

// ── PATCH /api/groups/:id/prefs ──────────────────────────────────────────
// Update the caller's PER-USER conversation preferences (migration 0023):
// archive, pin, mute, and "delete for me" (hidden). All are scoped to this
// user's group_members row — never global — and any member of the conversation
// may set their own. Each field is optional; only the provided ones change.
const prefsSchema = z
  .object({
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    // "Delete conversation" = hide for me. true hides; false un-hides (restores).
    hidden: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' })

readStateRouter.patch(
  '/:id/prefs',
  asyncHandler(async (req, res) => {
    const parsed = prefsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const data = parsed.data

    const sets: string[] = []
    const values: unknown[] = []
    // Timestamp flags store now()/null; muted is a plain boolean.
    if (data.archived !== undefined) sets.push(`archived_at = ${data.archived ? 'now()' : 'null'}`)
    if (data.pinned !== undefined) sets.push(`pinned_at = ${data.pinned ? 'now()' : 'null'}`)
    if (data.hidden !== undefined) sets.push(`hidden_at = ${data.hidden ? 'now()' : 'null'}`)
    if (data.muted !== undefined) {
      values.push(data.muted)
      sets.push(`muted = $${values.length}`)
    }

    values.push(groupId, userId)
    const { rows } = await pool.query<{
      archived_at: string | null
      pinned_at: string | null
      muted: boolean
      hidden_at: string | null
    }>(
      `update group_members
          set ${sets.join(', ')}
        where group_id = $${values.length - 1} and user_id = $${values.length}
        returning archived_at, pinned_at, muted, hidden_at`,
      values,
    )
    if (rows.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const r = rows[0]
    const prefs = {
      archivedAt: r.archived_at,
      pinnedAt: r.pinned_at,
      muted: r.muted,
      hiddenAt: r.hidden_at,
    }
    // Sync the caller's other tabs/devices so the row's state stays consistent.
    getIO().to(roomForUser(userId)).emit('group:prefs', { groupId, ...prefs })
    res.json({ ok: true, prefs })
  }),
)
