import { useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  MailOpen,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { Group } from '../lib/types'
import { groupHasUnread, groupLabel, groupPreview } from '../lib/types'
import { useDraft } from '../lib/draftStorage'
import { getOps, tripSummary } from '../lib/vehicleOps'
import { TripStatusInline } from '../components/vehicle/opsControls'
import Avatar from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'
import IdentitySlot from '../components/IdentitySlot'
import ConversationRowMenu, {
  type ConversationRowMenuHandle,
  type RowMenuAction,
} from '../components/ConversationRowMenu'
import { MENU_GLYPH } from '../components/menuStyles'
import { statusMeta, OFFLINE } from '../lib/availability'

// Compact last-activity stamp: today → HH:MM, yesterday → "Yesterday", otherwise
// DD/MM. Empty string when there's no timestamp.
function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    // 24-hour clock, matching message timestamps (see messageUtils.formatTime).
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  const yesterday = new Date()
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  // Explicit DD/MM (locale-independent) so it never renders as MM/DD.
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}`
}

// One conversation in the unified rail — a single, calm, monochrome row. The
// identity slot reads a conversation's TYPE by shape, not colour: a circular
// Avatar for a direct message (with a live presence dot), a `card`-radius
// GroupAvatar squircle for a vehicle room (its uploaded photo, or the generated
// glyph). The name is primary; a vehicle room's active-trip status trails it as
// quiet tone-coloured text. The right edge carries at most one piece of metadata
// (unread badge, else last-activity time) plus optional mute/mention markers,
// all of which fade on hover so the ⋮ actions button owns the far right without
// overlap or layout shift.
export default function GroupRow({
  group,
  selected,
  online,
  currentUserId,
  size,
  onClick,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: {
  group: Group
  selected: boolean
  // Live online user-id set (presence). Drives the DM status dot.
  online: Set<string>
  // Viewing user — decides the "You:" / name prefix on the preview line.
  currentUserId: string
  // Identity-slot diameter in design px (tracks display density).
  size: number
  onClick: () => void
  // Per-conversation row actions (the hover ⋮ menu). Each takes the row's group
  // plus the desired next state where it's a toggle.
  onTogglePin: (group: Group, pinned: boolean) => void
  onToggleArchive: (group: Group, archived: boolean) => void
  onToggleMute: (group: Group, muted: boolean) => void
  onMarkRead: (group: Group) => void
  onMarkUnread: (group: Group) => void
  onDelete: (group: Group) => void
}) {
  // A DM peer's dot: their declared status colour when online, dim grey when
  // offline (signed out / app closed). Live via socket presence.
  const peer = group.type === 'direct' ? group.directPeer : null
  const peerOnline = peer ? online.has(peer.id) : false
  const peerDot = peer
    ? peerOnline
      ? statusMeta(peer.availabilityStatus ?? 'available')
      : OFFLINE
    : null
  // Selecting a group clears its indicator immediately (it's about to be read).
  // Prefer the precise server count; fall back to the timestamp-based flag when
  // the API didn't send a count (older server) so the dot never disappears.
  const hasCount = typeof group.unreadCount === 'number'
  const unreadCount = selected ? 0 : group.unreadCount ?? 0
  const unread = selected ? false : hasCount ? unreadCount > 0 : groupHasUnread(group)
  // Unread @-mentions get their own compact badge, separate from the regular
  // unread dot/count, so being mentioned stands out from ordinary traffic.
  const hasUnreadMention = !selected && (group.unreadMentionCount ?? 0) > 0

  // Active-trip indicator for vehicle rooms: a compact status line read off the
  // manual ops blob. Null when there's no trip.
  const trip = group.type === 'vehicle' ? tripSummary(getOps(group)) : null
  const tripLineFull = trip
    ? [trip.statusLabel, trip.nextLabel && `Next: ${trip.nextLabel}`].filter(Boolean).join(' · ')
    : null

  const preview = groupPreview(group, currentUserId)
  const time = relTime(group.lastMessageAt)
  // Local unsent draft for THIS conversation (this user/device only — never
  // synced). When present it replaces the last-message preview with a subtle
  // "Draft: …" line; the timestamp keeps showing the real last message's time.
  const draft = useDraft(currentUserId, group.id).replace(/\s+/g, ' ').trim()

  // ── Per-conversation row actions (hover ⋮ menu) ────────────────────────────
  // While the ⋮ menu is open the row stays in its "actions active" state — the
  // trigger stays visible and the right-side metadata stays hidden — even after
  // the cursor leaves the row.
  const [menuOpen, setMenuOpen] = useState(false)
  // Right-clicking anywhere on the row opens the SAME actions menu at the cursor.
  const rowMenuRef = useRef<ConversationRowMenuHandle>(null)
  const openMenuAtCursor = (e: React.MouseEvent) => {
    e.preventDefault()
    rowMenuRef.current?.openAt(e.clientX, e.clientY)
  }
  const archived = Boolean(group.archivedAt)
  const pinned = Boolean(group.pinnedAt)
  const muted = Boolean(group.muted)
  // Shared fragment: the right-side metadata fades on row hover AND while the
  // menu is open, so nothing peeks out from behind/around the popover.
  const metaFade = `transition-opacity group-hover/row:opacity-0${menuOpen ? ' opacity-0' : ''}`
  // The menu's read/unread label reflects the ACTUAL stored unread, not the
  // selected→0 view used for the badge.
  const actuallyUnread = (group.unreadCount ?? 0) > 0
  const ICON = MENU_GLYPH
  const menuActions: RowMenuAction[] = [
    {
      key: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />,
      onSelect: () => onTogglePin(group, !pinned),
    },
    {
      key: 'read',
      label: actuallyUnread ? 'Mark as read' : 'Mark as unread',
      icon: <MailOpen {...ICON} />,
      onSelect: () => (actuallyUnread ? onMarkRead(group) : onMarkUnread(group)),
    },
    {
      key: 'mute',
      label: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? <Bell {...ICON} /> : <BellOff {...ICON} />,
      onSelect: () => onToggleMute(group, !muted),
    },
    {
      key: 'archive',
      label: archived ? 'Unarchive' : 'Archive',
      icon: archived ? <ArchiveRestore {...ICON} /> : <Archive {...ICON} />,
      onSelect: () => onToggleArchive(group, !archived),
    },
    {
      key: 'delete',
      label: 'Delete conversation',
      icon: <Trash2 {...ICON} />,
      danger: true,
      separator: true,
      confirmLabel: 'Confirm delete',
      onSelect: () => onDelete(group),
    },
  ]
  // On-hover/focus overlay holding the ⋮ menu, anchored to the row's right edge,
  // vertically centred. The conflicting right-side metadata fades out on hover so
  // the button sits cleanly on its own. pointer-events stay off until revealed so
  // the hidden trigger never blocks a click on the row beneath it.
  const rowActions = (
    <div
      className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto ${
        menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <ConversationRowMenu
        ref={rowMenuRef}
        actions={menuActions}
        ariaLabel={`Conversation actions for ${groupLabel(group)}`}
        onOpenChange={setMenuOpen}
      />
    </div>
  )
  // Muted indicator — fades with the rest of the right-side metadata on hover.
  const mutedIcon = muted ? (
    <BellOff size="0.75rem" strokeWidth={1.7} className={`shrink-0 text-faint ${metaFade}`} aria-label="Muted" />
  ) : null
  // Pinned indicator — a prominent pin on the row's RIGHT edge, vertically
  // centred. It stays visible at all times; on hover/focus — or while the actions
  // menu is open — it slides left so the ⋮ actions button can take the far-right
  // slot without overlapping. Decorative + pointer-events-none.
  const pinnedOverlay = pinned ? (
    <div
      title="Pinned"
      className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 z-0 text-muted transition-transform duration-200 ease-out group-hover/row:-translate-x-9 group-focus-within/row:-translate-x-9 ${
        menuOpen ? '-translate-x-9' : ''
      }`}
    >
      <Pin size="0.875rem" strokeWidth={1.8} aria-label="Pinned" />
    </div>
  ) : null

  return (
    <div className="relative group/row" onContextMenu={openMenuAtCursor}>
      <button
        onClick={onClick}
        style={{
          minHeight: 'var(--sidebar-row-height)',
          gap: 'var(--sidebar-row-gap)',
          paddingLeft: 'var(--sidebar-row-pad-x)',
          // Reserve room on the right for the pinned indicator so it never sits on
          // top of the metadata badge in the resting state.
          paddingRight: pinned ? 'calc(var(--sidebar-row-pad-x) + 20px)' : 'var(--sidebar-row-pad-x)',
          paddingTop: 'var(--sidebar-row-pad-y)',
          paddingBottom: 'var(--sidebar-row-pad-y)',
        }}
        className={`w-full flex items-center rounded-btn text-left transition-colors ${
          selected
            ? 'bg-white/[0.075] text-text'
            : 'text-muted hover:bg-white/[0.03] hover:text-text'
        }`}
      >
        {/* Identity — shape encodes the conversation type: circle = person,
            squircle = vehicle room. Monochrome; no coloured fills. The zero-
            height IdentitySlot keeps the larger avatar from adding row height. */}
        <IdentitySlot>
          {group.type === 'direct' ? (
            <Avatar userId={peer?.id ?? ''} name={peer?.name ?? groupLabel(group)} size={size} />
          ) : (
            <GroupAvatar
              groupId={group.id}
              hasAvatar={Boolean(group.hasAvatar)}
              shape="rounded"
              size={size}
            />
          )}
          {peerDot && (
            <span
              title={peerDot.label}
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg"
              style={{ backgroundColor: peerDot.color }}
            />
          )}
        </IdentitySlot>

        {/* Two-line body. Line 1: name (+ inline vehicle trip status). Line 2:
            last-message preview on the left, metadata on the right. Tight
            line-height groups the two lines into one block, vertically centred
            against the avatar. */}
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          {/* Line 1 — the name stays primary and only shrinks as a last resort;
              a vehicle's trip status ellipsizes first (shrinks 3×). */}
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span
              className={`min-w-0 shrink truncate leading-tight ${
                unread ? 'text-text font-semibold' : 'text-text/90 font-medium'
              }`}
              style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
            >
              {groupLabel(group)}
            </span>
            {trip && (
              <TripStatusInline
                tone={trip.statusTone}
                label={trip.statusLabel}
                title={tripLineFull ?? trip.statusLabel}
                className="shrink-[3] leading-tight"
                style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
              />
            )}
          </span>
          {/* Line 2 — latest-message preview + the right-side metadata cluster,
              which fades on hover so the ⋮ actions button can take the far-right
              slot without crowding it. */}
          <span className="flex items-center gap-2">
            <span
              className={`flex-1 min-w-0 truncate leading-tight ${unread ? 'text-muted' : 'text-faint'}`}
              style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
            >
              {draft ? (
                // A local unsent draft takes over the preview line, its "Draft:"
                // tag in the app's accent so it reads as a distinct, personal
                // state. The line truncates, so a long draft ellipsizes.
                <>
                  <span className="text-active font-medium">Draft: </span>
                  {draft}
                </>
              ) : (
                <>
                  {preview.prefix && (
                    <span className={unread ? 'text-muted font-medium' : 'text-faint'}>
                      {preview.prefix}{' '}
                    </span>
                  )}
                  {preview.text}
                </>
              )}
            </span>
            <span className={`flex items-center gap-2 shrink-0 ${metaFade}`}>
              {hasUnreadMention && (
                <span
                  aria-label="You were mentioned"
                  title="You were mentioned"
                  style={{
                    height: 'var(--sidebar-badge-size)',
                    minWidth: 'var(--sidebar-badge-size)',
                    fontSize: 'var(--sidebar-meta-font-size)',
                  }}
                  className="px-1 rounded-full bg-active/20 text-active font-bold leading-none flex items-center justify-center"
                >
                  @
                </span>
              )}
              {unread && hasCount && unreadCount > 0 && (
                <span
                  aria-label={`${unreadCount} unread`}
                  style={{
                    minWidth: 'var(--sidebar-badge-size)',
                    height: 'var(--sidebar-badge-size)',
                    fontSize: 'var(--sidebar-meta-font-size)',
                  }}
                  className="px-1.5 rounded-full bg-text text-bg font-semibold leading-none flex items-center justify-center"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {mutedIcon}
              {time && (
                <span className="tabular-nums text-faint" style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}>
                  {time}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
      {pinnedOverlay}
      {rowActions}
    </div>
  )
}
