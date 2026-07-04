import { Router } from 'express'
import { pool } from '../../db/pool.js'
import { asyncHandler } from '../../http.js'

export const listRouter = Router()

// ── GET /api/groups ──────────────────────────────────────────────────────
// Lists every group the current user belongs to, ordered by recent activity.
// Driven by the group_members(user_id, group_id) index seek; the result set
// (a single user's groups) is small enough that the final sort is free.
//
// Unread counters are DENORMALIZED (migration 0020): unread_count and
// unread_mention_count are stored on group_members and maintained incrementally
// on the write paths, so this read is a plain column fetch instead of two
// correlated subqueries per group. last_read_at stays the source of truth for
// per-message read receipts; these counters are only the sidebar badge numbers.
// Maintenance lives in: POST /messages + forward (increment), POST /:id/read
// (reset to 0), delete-for-everyone / delete-for-me (decrement), and
// groupInvites accept (seed on join). member_count stays a subquery — it's a
// cheap PK count and there's no safe stored value to read instead yet.
listRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!

    // Membership is the authorization boundary — the join restricts to groups
    // the caller actually belongs to. We deliberately do NOT filter on
    // workspace_id: cross-workspace DMs carry a NULL workspace_id and must
    // still appear. The LATERAL pulls the "other person" for direct groups so
    // the client can label a DM without an extra round-trip.
    const { rows } = await pool.query<{
      id: string
      type: 'vehicle' | 'direct'
      name: string | null
      description: string | null
      meta: Record<string, unknown>
      avatar_path: string | null
      last_message_at: string | null
      created_at: string
      last_read_at: string | null
      member_count: number
      unread_count: number
      unread_mention_count: number
      // Per-user conversation prefs (migration 0023).
      archived_at: string | null
      pinned_at: string | null
      muted: boolean
      peer_id: string | null
      peer_name: string | null
      peer_workspace: string | null
      peer_availability: string | null
      last_body: string | null
      last_author_id: string | null
      last_author_name: string | null
      last_deleted_at: string | null
      last_has_attachments: boolean | null
    }>(
      `select g.id, g.type, g.name, g.description, g.meta, g.avatar_path,
              g.last_message_at, g.created_at,
              gm.last_read_at,
              (select count(*)::int from group_members where group_id = g.id) as member_count,
              -- Denormalized counters (migration 0020), maintained on write.
              gm.unread_count,
              gm.unread_mention_count,
              -- Per-user conversation prefs (migration 0023).
              gm.archived_at, gm.pinned_at, gm.muted,
              peer.peer_id, peer.peer_name, peer.peer_workspace, peer.peer_availability,
              -- Latest USER message (matches last_message_at, which system rows
              -- don't bump) for the sidebar preview. Skips messages the caller
              -- deleted for themselves, same as the thread view.
              lm.body as last_body, lm.author_id as last_author_id,
              lm.author_name as last_author_name, lm.deleted_at as last_deleted_at,
              lm.has_attachments as last_has_attachments
         from groups g
         join group_members gm on gm.group_id = g.id and gm.user_id = $1
         left join lateral (
           select u.id as peer_id,
                  u.display_name as peer_name,
                  w.name as peer_workspace,
                  u.availability_status as peer_availability
             from group_members gm2
             join users u on u.id = gm2.user_id
             join workspaces w on w.id = u.workspace_id
            where gm2.group_id = g.id and gm2.user_id <> $1
            limit 1
         ) peer on g.type = 'direct'
         left join lateral (
           select m.body, m.author_id, m.deleted_at,
                  au.display_name as author_name,
                  exists (select 1 from attachments a where a.message_id = m.id) as has_attachments
             from messages m
             join users au on au.id = m.author_id
            where m.group_id = g.id
              and m.kind = 'user'
              and not exists (
                select 1 from message_deletions md
                 where md.message_id = m.id and md.user_id = $1
              )
            order by m.created_at desc
            limit 1
         ) lm on true
        where g.archived_at is null
          -- "Delete for me" (migration 0023): stay hidden until a NEWER message
          -- bumps last_message_at past the hide point, then reappear.
          and not (
            gm.hidden_at is not null
            and coalesce(g.last_message_at, g.created_at) <= gm.hidden_at
          )
        order by g.last_message_at desc nulls last, g.created_at desc
        limit 200`,
      [userId],
    )

    res.json({
      groups: rows.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        description: r.description,
        meta: r.meta,
        hasAvatar: r.avatar_path !== null,
        lastMessageAt: r.last_message_at,
        lastReadAt: r.last_read_at,
        createdAt: r.created_at,
        memberCount: r.member_count,
        unreadCount: r.unread_count,
        unreadMentionCount: r.unread_mention_count,
        archivedAt: r.archived_at,
        pinnedAt: r.pinned_at,
        muted: r.muted,
        directPeer:
          r.type === 'direct' && r.peer_id
            ? {
                id: r.peer_id,
                name: r.peer_name,
                workspace: r.peer_workspace,
                availabilityStatus: r.peer_availability,
              }
            : null,
        // Compact preview of the latest user message for the sidebar. Body is
        // cleared for a soft-deleted message (the `deleted` flag drives its
        // "Deleted message" label client-side).
        lastMessage: r.last_author_id
          ? {
              body: r.last_deleted_at ? '' : r.last_body ?? '',
              authorId: r.last_author_id,
              authorName: r.last_author_name ?? '',
              deleted: r.last_deleted_at !== null,
              hasAttachments: r.last_has_attachments ?? false,
            }
          : null,
      })),
    })
  }),
)
