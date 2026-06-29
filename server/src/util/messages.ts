import { pool, type DbClient } from '../db/pool.js'
import { getIO, roomForGroup } from '../realtime.js'

// ── Shared message projection ────────────────────────────────────────────
// One column list + row type + mapper so every endpoint that returns a fully
// rendered message (the thread page, the pins list, a freshly pinned message,
// a system/activity row) produces the exact same client shape. Selects from
// `messages m join users u on u.id = m.author_id`; subqueries reference `m`, so
// no extra params. Lives here (not in a route) so any router — groups, invites —
// can render and emit messages identically.
export const MESSAGE_COLUMNS = `
  m.id, m.author_id, u.display_name as author_name,
  m.body, m.created_at, m.edited_at,
  m.deleted_at, m.deleted_by, m.forwarded,
  m.pinned_at, m.pinned_by,
  m.kind, m.system_event, m.system_target_message_id, m.system_payload,
  (select coalesce(
      jsonb_agg(jsonb_build_object(
        'id',            a.id,
        'original_name', a.original_name,
        'mime_type',     a.mime_type,
        'byte_size',     a.byte_size,
        'preview_path',  a.preview_path,
        'width',         a.width,
        'height',        a.height,
        'missing',       a.missing
      ) order by a.created_at asc),
      '[]'::jsonb)
     from attachments a
    where a.message_id = m.id) as attachments,
  (select jsonb_build_object(
      'id',              rm.id,
      'author_name',     ru.display_name,
      'body',            case when rm.deleted_at is not null then '' else rm.body end,
      'has_attachments', exists (select 1 from attachments ra where ra.message_id = rm.id),
      'deleted',         rm.deleted_at is not null
    )
     from messages rm
     join users ru on ru.id = rm.author_id
    where rm.id = m.reply_to_message_id) as reply_to,
  (select coalesce(
      jsonb_agg(jsonb_build_object(
        'user_id',      mu.id,
        'display_name', mu.display_name
      ) order by mm.created_at asc),
      '[]'::jsonb)
     from message_mentions mm
     join users mu on mu.id = mm.mentioned_user_id
    where mm.message_id = m.id) as mentions`

export const MESSAGE_FROM = `from messages m join users u on u.id = m.author_id`

export type MessageRow = {
  id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  forwarded: boolean
  pinned_at: string | null
  pinned_by: string | null
  kind: 'user' | 'system'
  system_event: string | null
  system_target_message_id: string | null
  system_payload: Record<string, unknown> | null
  attachments:
    | Array<{
        id: string
        original_name: string
        mime_type: string
        byte_size: number
        preview_path: string | null
        width: number | null
        height: number | null
        missing: boolean
      }>
    | null
  reply_to: {
    id: string
    author_name: string
    body: string
    has_attachments: boolean
    deleted: boolean
  } | null
  mentions: Array<{ user_id: string; display_name: string }> | null
}

// Map a DB row to the API message shape. Soft-deleted messages have their body
// and attachments cleared server-side so the original content never leaks.
export function mapMessageRow(m: MessageRow) {
  const isDeleted = m.deleted_at !== null
  return {
    id: m.id,
    authorId: m.author_id,
    authorName: m.author_name,
    body: isDeleted ? '' : m.body,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    deletedAt: m.deleted_at,
    deletedBy: m.deleted_by,
    forwarded: m.forwarded,
    pinnedAt: m.pinned_at,
    pinnedBy: m.pinned_by,
    // Activity rows. 'user' is the default; system rows carry the event +
    // target + structured payload so the client can render a compact timeline
    // entry (who joined, who was added, the pinned message, the trip label …).
    kind: m.kind,
    ...(m.kind === 'system'
      ? {
          systemEvent: m.system_event,
          systemTargetMessageId: m.system_target_message_id,
          systemPayload: m.system_payload,
        }
      : {}),
    attachments: isDeleted
      ? []
      : (m.attachments ?? []).map((a) => ({
          id: a.id,
          originalName: a.original_name,
          mimeType: a.mime_type,
          byteSize: Number(a.byte_size),
          url: `/api/attachments/${a.id}`,
          // Small preview for chat bubbles; only when one was generated
          // (GIFs / pre-migration images fall back to the original).
          ...(a.preview_path
            ? { previewUrl: `/api/attachments/${a.id}?variant=preview` }
            : {}),
          ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
          ...(a.missing ? { missing: true } : {}),
        })),
    replyTo: m.reply_to
      ? {
          id: m.reply_to.id,
          authorName: m.reply_to.author_name,
          body: m.reply_to.body,
          hasAttachments: m.reply_to.has_attachments,
          deleted: m.reply_to.deleted,
        }
      : null,
    // Deleted messages drop their mentions too — there's no body left to
    // highlight and the highlight would imply content that's gone.
    mentions: isDeleted
      ? []
      : (m.mentions ?? []).map((x) => ({
          userId: x.user_id,
          displayName: x.display_name,
        })),
  }
}

// Fetch a single fully-rendered message by id (same shape as the thread list).
// Used to build broadcast/response payloads for pin/unpin + every system row.
export async function loadMessage(id: string) {
  const { rows } = await pool.query<MessageRow>(
    `select ${MESSAGE_COLUMNS} ${MESSAGE_FROM} where m.id = $1`,
    [id],
  )
  return rows.length ? mapMessageRow(rows[0]) : null
}

// ── System / activity messages ───────────────────────────────────────────
// Persisted, in-timeline activity entries. Each is a normal `messages` row with
// kind='system' (author_id = actor, so the users join yields the actor name),
// so it flows through the list/pagination/cache/socket plumbing unchanged and
// only differs at render time. Add new operational events here as the union
// grows — the renderer (SystemMessageRow) degrades unknown events gracefully.
export type SystemEvent =
  | 'group_joined' // a user joined (accepted an invite)
  | 'group_member_added' // an actor added another user (payload.userName)
  | 'group_member_removed' // an actor removed another user (payload.userName)
  | 'group_member_left' // a member left the group themselves (actor = the leaver)
  | 'message_pinned' // targetMessageId set
  | 'message_unpinned' // targetMessageId set
  | 'trip_created' // legacy — superseded by trip_added
  | 'trip_added' // a trip was added to the room (payload.tripLabel = reference)
  | 'trip_status_changed' // payload.from / payload.to = TripStatus codes
  | 'route_edited' // the trip route was (re)computed/edited

// Insert a system row in a group's timeline. Returns the new message id (load +
// emit it post-commit via emitSystemMessage). Deliberately does NOT touch
// groups.last_message_at — activity rows must not reorder the sidebar or count
// as unread (the unread query also filters kind='user').
export async function insertSystemMessage(
  client: DbClient,
  opts: {
    groupId: string
    actorId: string
    event: SystemEvent
    targetMessageId?: string | null
    payload?: Record<string, unknown> | null
  },
): Promise<string> {
  const { groupId, actorId, event, targetMessageId = null, payload = null } = opts
  const { rows } = await client.query<{ id: string }>(
    `insert into messages
       (group_id, author_id, body, kind, system_event, system_actor_id,
        system_target_message_id, system_payload)
     values ($1, $2, '', 'system', $3, $2, $4, $5::jsonb)
     returning id`,
    [groupId, actorId, event, targetMessageId, payload ? JSON.stringify(payload) : null],
  )
  return rows[0].id
}

// Load a just-inserted system message and broadcast it to the group room as
// `message:system`. Call AFTER the transaction commits. The client cache folds
// it into the thread on its own event (not message:new), so it renders live and
// in order without bumping unread counts.
export async function emitSystemMessage(id: string, groupId: string): Promise<void> {
  const message = await loadMessage(id)
  if (message) getIO().to(roomForGroup(groupId)).emit('message:system', { ...message, groupId })
}
