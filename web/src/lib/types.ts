// Shared shapes for data crossing the API boundary. Kept in one place so the
// fetch helpers, socket events, and components all agree.

import type { VehicleOps } from './vehicleOps'

export type GroupType = 'vehicle' | 'direct'

export type Role = 'admin' | 'dispatcher' | 'driver' | 'partner'
export type AvailabilityStatus = 'available' | 'busy' | 'off_duty'

// The current user's operational profile (own data only).
export type Profile = {
  id: string
  email: string
  displayName: string
  role: Role
  jobTitle: string | null
  workPhone: string | null
  nativeLanguage: string | null
  otherLanguages: string[]
  availabilityStatus: AvailabilityStatus
  hasAvatar: boolean
  company: string
}

// The company / workspace operational profile.
export type CompanyProfile = {
  id: string
  name: string
  legalName: string | null
  vatId: string | null
  country: string | null
  city: string | null
  operationalAddress: string | null
  dispatchEmail: string | null
  dispatchPhone: string | null
  website: string | null
  hasLogo: boolean
  /** True when the caller is an admin and may edit these fields. */
  canEdit: boolean
}

export type DirectPeer = {
  id: string
  name: string | null
  workspace: string | null
  /** The peer's declared availability (manual status), for the DM row dot.
   *  Optional: older responses / optimistic rows omit it. */
  availabilityStatus?: AvailabilityStatus
}

export type Group = {
  id: string
  type: GroupType
  name: string | null
  description: string | null
  /**
   * Vehicle metadata. A vehicle group is a permanent thread for one truck,
   * reused across many trips/loads over time:
   *   - `tractorPlate` — cap tractor registration number
   *   - `trailerPlate` — remorca registration number
   * `plate` is the legacy single-plate field from before the tractor/trailer
   * split; it's still read (mapped to the tractor plate) so existing groups
   * keep working. `trip` is legacy too — old groups may carry it, but it's no
   * longer asked for or surfaced. New groups never set either.
   */
  meta: {
    tractorPlate?: string
    trailerPlate?: string
    /** Manual operational data for the vehicle room (vehicle details, one active
     *  trip, and stops) — edited by dispatchers, persisted in this JSONB blob.
     *  See lib/vehicleOps.ts. Absent on groups that have never set it. */
    ops?: VehicleOps
    /** @deprecated legacy single plate — read as a tractor-plate fallback. */
    plate?: string
    /** @deprecated legacy one-trip label — kept for old groups, not shown. */
    trip?: string
  } & Record<string, unknown>
  /** True when the vehicle group has an uploaded image. Drives whether the
   *  group-info panel shows a "Remove" control; the header avatar attempts the
   *  image regardless and falls back to the icon on 404. Optional for
   *  forward-compat with older responses / optimistic rows. */
  hasAvatar?: boolean
  lastMessageAt: string | null
  lastReadAt: string | null
  createdAt: string
  memberCount: number
  /** Count of messages from others, after my last read, that I haven't seen.
   *  Optional: older API responses omit it — callers fall back to the
   *  timestamp-based `groupHasUnread`. */
  unreadCount?: number
  /** How many of those unread messages @-mention me. Drives the sidebar's
   *  separate "@" badge. Optional for forward-compat with older responses. */
  unreadMentionCount?: number
  directPeer: DirectPeer | null
  /** Compact preview of the latest USER message (matches `lastMessageAt`), for
   *  the Normal-view sidebar row's second line. Null when the thread has no
   *  messages. Optional for forward-compat with older responses. */
  lastMessage?: GroupLastMessage | null
}

// Just enough of the latest message to render a one-line sidebar preview.
// `body` is empty for a deleted message (use the `deleted` flag); `authorId`
// decides the "You:" / name prefix; `hasAttachments` drives the attachment
// fallback when there's no text.
export type GroupLastMessage = {
  body: string
  authorId: string
  authorName: string
  deleted: boolean
  hasAttachments: boolean
}

// A group's display label depends on its type: vehicle groups carry a name,
// direct groups are labelled by the other participant.
export function groupLabel(g: Group): string {
  if (g.type === 'direct') return g.directPeer?.name ?? 'Direct message'
  return g.name ?? 'Untitled group'
}

// Tractor (cap) registration for a vehicle group, falling back to the legacy
// single `plate` so groups created before the tractor/trailer split still show
// their plate. Returns undefined when none is set.
export function tractorPlate(g: Group): string | undefined {
  return g.meta.tractorPlate ?? g.meta.plate
}

// Trailer (remorca) registration for a vehicle group. No legacy fallback —
// trailers were not modelled before the split.
export function trailerPlate(g: Group): string | undefined {
  return g.meta.trailerPlate
}

// Build the one-line latest-message preview for a sidebar row, split into an
// optional `prefix` (rendered slightly distinct) and the `text`. Prefix rules:
//   - mine (any type) → none  (my own last message just shows the message)
//   - DM, peer        → none  (the row already names the peer)
//   - vehicle, other  → "<First name>:"  (name who spoke, since it's not me)
// Fallbacks: deleted → "Deleted message", attachment-only → "Attachment",
// empty/none → "No messages yet".
export function groupPreview(
  g: Group,
  currentUserId: string,
): { prefix: string | null; text: string } {
  const lm = g.lastMessage
  if (!lm) return { prefix: null, text: 'No messages yet' }

  const mine = lm.authorId === currentUserId
  let text: string
  if (lm.deleted) text = 'Deleted message'
  else if (lm.body.trim()) text = lm.body.trim()
  else if (lm.hasAttachments) text = 'Attachment'
  else text = 'No messages yet'

  // Only vehicle rooms name the last sender, and only when it isn't me — my own
  // messages (DM or group) show just the text, with no "You:" prefix.
  const prefix =
    !mine && g.type !== 'direct'
      ? `${(lm.authorName || 'Member').split(' ')[0]}:`
      : null
  return { prefix, text }
}

export function groupHasUnread(g: Group): boolean {
  if (!g.lastMessageAt) return false
  if (!g.lastReadAt) return true
  return new Date(g.lastMessageAt) > new Date(g.lastReadAt)
}

export type Attachment = {
  id: string
  originalName: string
  mimeType: string
  byteSize: number
  /** Authenticated URL (relative to origin) — fetch with credentials. The
   *  full original; used by the lightbox modal and downloads. */
  url: string
  /**
   * Authenticated URL of the small WebP preview, for chat-bubble rendering.
   * Present only for images that have a generated preview; absent for GIFs,
   * documents, and images uploaded before previews existed — callers fall
   * back to `url`.
   */
  previewUrl?: string
  /** Preview's intrinsic dimensions (shares the original's aspect ratio), used
   *  to reserve the bubble box and avoid layout shift. */
  width?: number
  height?: number
  /** The backing storage object is known to be gone (detected on a prior serve
   *  attempt). The bubble renders the "unavailable" card immediately instead of
   *  attempting to load. */
  missing?: boolean
  /**
   * Transient local object URL (blob:) for an image the current user just
   * sent. Set client-side only — the server never returns it. Rendered in
   * place of `url` so the just-sent image shows instantly with zero flicker
   * across the optimistic→server reconcile, then revoked when the conversation
   * unmounts.
   */
  localPreviewUrl?: string
}

// Compact view of the message a reply points at — author + a short
// snippet + whether the original had attachments / has been deleted.
// Just enough to render the quoted preview without round-tripping.
export type ReplyToPreview = {
  id: string
  authorName: string
  body: string
  hasAttachments: boolean
  deleted: boolean
}

export type Message = {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  editedAt?: string | null
  deletedAt?: string | null
  deletedBy?: string | null
  forwarded?: boolean
  attachments?: Attachment[]
  replyTo?: ReplyToPreview | null
  /** Set when the message is pinned group-wide; null/absent otherwise. */
  pinnedAt?: string | null
  pinnedBy?: string | null
  /**
   * Activity-row kind. 'user' (default/absent) is a normal chat message;
   * 'system' is a persisted activity entry (e.g. pin/unpin) rendered as a
   * compact centered timeline row, not a bubble.
   */
  kind?: 'user' | 'system'
  /** For system rows: which activity this is (e.g. group_joined,
   *  group_member_added, message_pinned, message_unpinned, trip_created). */
  systemEvent?: string | null
  /** For system rows: the message the activity refers to (clickable to jump). */
  systemTargetMessageId?: string | null
  /** For system rows: structured detail for rendering (e.g. the added user's
   *  name, or a trip label). Shape varies by event. */
  systemPayload?: {
    userId?: string
    userName?: string
    tripLabel?: string
  } | null
  /** Users @-mentioned in this message. Drives the highlighted mention tokens
   *  in the bubble. Absent/empty when the message mentions no one. */
  mentions?: Mention[]
}

// One @-mention inside a message: the user id (for "is this me?" highlighting
// and future notifications) plus the display name (the literal text rendered).
export type Mention = { userId: string; displayName: string }

// A member of a single conversation — the source for the @-mention picker and
// the group-info panel's member list. The mention picker only needs id +
// displayName; the panel reads the rest (all optional for that reason).
export type GroupMember = {
  id: string
  displayName: string
  workspace: string | null
  /** Membership role within this group ('admin' | 'member'). */
  role?: 'admin' | 'member'
  /** The member's workspace role (admin/dispatcher/driver/partner). */
  userRole?: Role
  /** Declared availability — drives the member-row status dot. Drivers have
   *  no meaningful availability. */
  availabilityStatus?: AvailabilityStatus
  /** Whether this member has an avatar image (lets the row skip a 404). */
  hasAvatar?: boolean
  /** This member's "read up to" timestamp for the conversation. Per-message
   *  read receipts are derived from it: a message is seen by this member iff
   *  lastReadAt >= the message's createdAt. Kept fresh live via `group:read`.
   *  Absent for the @-mention picker's lightweight callers. */
  lastReadAt?: string | null
}

// Payload of the `message:new` socket event — same as Message plus groupId.
export type IncomingMessage = Message & { groupId: string }

export type WorkspaceMember = {
  id: string
  displayName: string
  email: string
  role: string
}

// A company invite link as listed in Workspace settings (admin only). The raw
// token is NOT part of this — it's shown only once, at creation, via
// WorkspaceInviteCreated.
export type WorkspaceInviteStatus = 'active' | 'used' | 'expired'
export type WorkspaceInvite = {
  id: string
  status: WorkspaceInviteStatus
  createdAt: string
  expiresAt: string
  usedAt: string | null
  createdByName: string | null
  usedByName: string | null
}

// The freshly-generated invite, returned once at creation with the shareable
// link and raw token (never persisted server-side, never re-fetchable).
export type WorkspaceInviteCreated = {
  id: string
  token: string
  url: string
  status: 'active'
  createdAt: string
  expiresAt: string
}

// Result of validating an invite token on the public registration page.
export type InviteValidation =
  | { status: 'valid'; companyName: string }
  | { status: 'used' | 'expired' | 'invalid' }

// A person returned by the platform-wide directory search. `connection` is
// the caller's connection state with this user (null if none exists).
export type DirectoryUser = {
  id: string
  displayName: string
  email: string
  workspace: { id: string; name: string }
  sameWorkspace: boolean
  connection: {
    status: 'pending' | 'accepted' | 'declined'
    requestedByMe: boolean
  } | null
}

export type ConnectionUser = {
  id: string
  displayName: string
  email: string
  workspace: { id: string; name: string }
}

export type Connection = {
  id: string
  status: 'pending' | 'accepted' | 'declined'
  message: string | null
  requestedAt: string
  respondedAt: string | null
  otherUser: ConnectionUser
}

export type ConnectionsResponse = {
  accepted: Connection[]
  pendingReceived: Connection[]
  pendingSent: Connection[]
}

// A pending invitation for the current user to join a permanent vehicle group.
// Intra-workspace only — distinct from cross-company connection requests.
export type GroupInvite = {
  id: string
  groupId: string
  groupName: string | null
  tractorPlate?: string
  trailerPlate?: string
  invitedByName: string
  invitedByUserId: string
  createdAt: string
}

// A user already invited to a group (pending) — used by the invite picker to
// show "Invited" state alongside "Member".
export type GroupPendingInvitee = {
  id: string
  userId: string
  displayName: string
}
