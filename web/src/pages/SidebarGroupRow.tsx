import { useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CircleUser,
  MailOpen,
  Pin,
  PinOff,
  Trash2,
  Users,
} from 'lucide-react'
import type { Group } from '../lib/types'
import { groupHasUnread, groupLabel, groupPreview } from '../lib/types'
import { getOps, tripSummary } from '../lib/vehicleOps'
import { StatusChip, StatusDot } from '../components/vehicle/opsControls'
import Avatar from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'
import ConversationRowMenu, {
  type ConversationRowMenuHandle,
  type RowMenuAction,
} from '../components/ConversationRowMenu'
import { statusMeta, OFFLINE } from '../lib/availability'
import { useViewMode } from '../lib/viewMode'

// Compact last-activity stamp for a Normal-view row: today → HH:MM, yesterday →
// "Yesterday", otherwise DD/MM. Empty string when there's no timestamp.
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

export default function GroupRow({
  group,
  selected,
  online,
  currentUserId,
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
  // Viewing user — decides the "You:" / name prefix on the Normal-view preview.
  currentUserId: string
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
  // Leading identity slot depends on the VIEW MODE:
  //  - compact (default): the original small type glyph — CircleUser for a DM,
  //    Users for a vehicle room — kept faint so the name stays the focus. Dense.
  //  - normal: a larger avatar-like slot (DM photo or generic contact icon,
  //    generated vehicle icon), sized to the density tier — preview-ready layout.
  const viewMode = useViewMode()
  const TypeIcon = group.type === 'direct' ? CircleUser : Users

  // Active-trip indicator for vehicle rooms: a compact status line read off the
  // manual ops blob. Null when there's no trip, so the row keeps its existing
  // (non-trip) subtitle/metadata. `full` (status · Next: …) is used on the
  // breathable Normal row; `short` (status only) on the dense Compact row.
  const trip = group.type === 'vehicle' ? tripSummary(getOps(group)) : null
  const tripLineFull = trip
    ? [trip.statusLabel, trip.nextLabel && `Next: ${trip.nextLabel}`].filter(Boolean).join(' · ')
    : null

  // ── Per-conversation row actions (hover ⋮ menu) ────────────────────────────
  // While the ⋮ menu is open the row stays in its "actions active" state — the
  // trigger stays visible and the right-side metadata stays hidden — even after
  // the cursor leaves the row, so the timestamp/status never reappears behind the
  // open menu. Reset when the menu closes (then hover alone governs again).
  const [menuOpen, setMenuOpen] = useState(false)
  // Right-clicking anywhere on the row opens the SAME actions menu at the cursor,
  // via the menu's imperative handle (a desktop affordance alongside the ⋮ button).
  const rowMenuRef = useRef<ConversationRowMenuHandle>(null)
  const openMenuAtCursor = (e: React.MouseEvent) => {
    e.preventDefault()
    rowMenuRef.current?.openAt(e.clientX, e.clientY)
  }
  const archived = Boolean(group.archivedAt)
  const pinned = Boolean(group.pinnedAt)
  const muted = Boolean(group.muted)
  // Class fragment shared by every right-side metadata element: it fades on row
  // hover AND while the menu is open (kept hidden so nothing peeks out from
  // behind/around the popover).
  const metaFade = `transition-opacity group-hover/row:opacity-0${menuOpen ? ' opacity-0' : ''}`
  // The menu's read/unread label reflects the ACTUAL stored unread, not the
  // selected→0 view used for the badge.
  const actuallyUnread = (group.unreadCount ?? 0) > 0
  const ICON = { size: 13, strokeWidth: 1.7 } as const
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
      confirmLabel: 'Confirm delete',
      onSelect: () => onDelete(group),
    },
  ]
  // On-hover/focus overlay holding the ⋮ menu, anchored to the row's right edge,
  // vertically centred over the WHOLE row. The conflicting right-side metadata
  // (trip badge + timestamp/counts) fades out on hover (see the matching
  // group-hover/row:opacity-0 below) so the button sits cleanly on its own at the
  // far right instead of wedged between the badge and the timestamp. pointer-
  // events stay off until revealed so the hidden trigger never blocks a click on
  // the row beneath it; it stays visible while its menu is open (focus-within).
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
  // Small muted indicator shared by both view densities. Fades with the rest of
  // the right-side metadata on hover so the action button owns the far right.
  const mutedIcon = muted ? (
    <BellOff size="0.75rem" strokeWidth={1.7} className={`shrink-0 text-faint ${metaFade}`} aria-label="Muted" />
  ) : null
  // Pinned indicator — a prominent pin on the row's RIGHT edge (the same area the
  // metadata/actions live), vertically centred over the whole row. It stays
  // visible at all times; on hover/focus — or while the actions menu is open — it
  // slides left so the ⋮ actions button can take the far-right slot without
  // overlapping it. Decorative + pointer-events-none so it never blocks the row
  // click. The Pin/Unpin menu action and the top-of-list sort live elsewhere.
  // Applies to both DMs and groups/vehicle rooms; rendered in each view below.
  const pinnedOverlay = pinned ? (
    <div
      title="Pinned"
      className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 z-0 text-muted transition-transform duration-200 ease-out group-hover/row:-translate-x-9 group-focus-within/row:-translate-x-9 ${
        menuOpen ? '-translate-x-9' : ''
      }`}
    >
      <Pin size="1rem" strokeWidth={1.8} aria-label="Pinned" />
    </div>
  ) : null

  // ── Normal view: breathable two-line rows with a last-message preview ──────
  // Larger avatar, more padding, name on line 1 (+ time), preview on line 2 (+
  // unread/mention badges). Compact view is left exactly as it was below.
  if (viewMode === 'normal') {
    const NORMAL_AVATAR = 44
    const preview = groupPreview(group, currentUserId)
    const time = relTime(group.lastMessageAt)
    return (
      <div className="relative group/row" onContextMenu={openMenuAtCursor}>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[3.875rem] rounded-chip text-left transition-colors ${
          pinned ? 'pr-7' : ''
        } ${selected ? 'bg-white/[0.06] text-text' : 'text-muted hover:bg-white/[0.025] hover:text-text'}`}
      >
        <span className="relative shrink-0 flex">
          {group.type === 'direct' ? (
            <Avatar
              userId={peer?.id ?? ''}
              name={peer?.name ?? groupLabel(group)}
              size={NORMAL_AVATAR}
            />
          ) : (
            <GroupAvatar groupId={group.id} hasAvatar={Boolean(group.hasAvatar)} size={NORMAL_AVATAR} />
          )}
          {peerDot && (
            <span
              title={peerDot.label}
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-rail"
              style={{ backgroundColor: peerDot.color }}
            />
          )}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          {/* Line 1 — just the name. No company/timestamp here: the timestamp
              sits with the preview on line 2, keeping the name row clean. The
              vehicle's active-trip status chip is the one small indicator that
              belongs on the title line. */}
          <span className="flex items-center gap-2">
            <span className={`flex-1 truncate text-[0.96875rem] ${unread ? 'text-text font-semibold' : 'text-text/90'}`}>
              {groupLabel(group)}
            </span>
            {trip && (
              <span className={`shrink-0 ${metaFade}`} title={tripLineFull ?? trip.statusLabel}>
                <StatusChip tone={trip.statusTone} label={trip.statusLabel} />
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {/* Latest-message preview — always shown (incl. vehicle rooms with an
                active trip); the trip status lives in the chip on the title line. */}
            <span className={`flex-1 truncate text-[0.875rem] ${unread ? 'text-muted' : 'text-faint'}`}>
              {preview.prefix && (
                <span className={unread ? 'text-muted font-medium' : 'text-faint'}>{preview.prefix} </span>
              )}
              {preview.text}
            </span>
            {/* Right-side metadata cluster — fades out on row hover so the action
                button can take the far-right slot without crowding it. */}
            <span className={`flex items-center gap-2 shrink-0 ${metaFade}`}>
              {hasUnreadMention && (
                <span
                  aria-label="You were mentioned"
                  title="You were mentioned"
                  className="h-[1.125rem] min-w-[1.125rem] px-1 rounded-full bg-active/20 text-active text-[0.65625rem] font-bold leading-none flex items-center justify-center"
                >
                  @
                </span>
              )}
              {unread && hasCount && unreadCount > 0 && (
                <span
                  aria-label={`${unreadCount} unread`}
                  className="h-[1.125rem] min-w-[1.125rem] px-1.5 rounded-full bg-active text-bg text-[0.65625rem] font-semibold leading-none flex items-center justify-center"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {muted && mutedIcon}
              {/* Last-activity stamp — lives on the preview line (right side), not
                  the name line, so all rows share the same metadata baseline. */}
              {time && <span className="text-[0.78125rem] text-faint tabular-nums">{time}</span>}
            </span>
          </span>
        </span>
      </button>
      {pinnedOverlay}
      {rowActions}
      </div>
    )
  }

  return (
    <div className="relative group/row" onContextMenu={openMenuAtCursor}>
    <button
      onClick={onClick}
      style={{
        minHeight: 'var(--sidebar-row-height)',
        gap: 'var(--sidebar-row-gap)',
        paddingLeft: 'var(--sidebar-row-pad-x)',
        // Reserve room on the right for the pinned indicator so it never sits on
        // top of the workspace label / unread badge in the resting state.
        paddingRight: pinned ? 'calc(var(--sidebar-row-pad-x) + 22px)' : 'var(--sidebar-row-pad-x)',
        paddingTop: 'var(--sidebar-row-pad-y)',
        paddingBottom: 'var(--sidebar-row-pad-y)',
      }}
      className={`w-full flex items-center rounded-chip text-left transition-colors ${
        selected
          ? 'bg-white/[0.06] text-text'
          : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${unread ? 'bg-active' : 'bg-transparent'}`}
      />
      <span className="relative shrink-0 flex">
        <TypeIcon
          strokeWidth={1.6}
          style={{ width: 'var(--sidebar-icon-size)', height: 'var(--sidebar-icon-size)' }}
          className={`shrink-0 ${unread ? 'text-muted' : 'text-faint'}`}
        />
        {/* DM peer presence: live online/offline via socket, coloured by the
            peer's declared status when online and dim grey when offline. */}
        {peerDot && (
          <span
            title={peerDot.label}
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-rail"
            style={{ backgroundColor: peerDot.color }}
          />
        )}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span
          className={`min-w-0 truncate ${unread ? 'text-text font-medium' : ''}`}
          style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
        >
          {groupLabel(group)}
        </span>
        {/* Vehicle-room active trip → a tiny colored status dot hugging the room
            name. The Compact row is a single dense line, so a dot (not a chip)
            keeps it uncluttered; the full status shows on hover. */}
        {trip && <StatusDot tone={trip.statusTone} title={tripLineFull ?? trip.statusLabel} />}
      </span>
      {/* DM-only: the peer's company/workspace on the right, filling the unused
          Compact-view space so cross-company users are identifiable without a
          full preview row. Muted + capped + truncated; `peer` is null for
          vehicle rooms so they get no right-side metadata. */}
      {peer?.workspace && (
        <span
          title={peer.workspace}
          className={`shrink truncate text-right text-faint ${metaFade}`}
          style={{ fontSize: 'var(--sidebar-conv-meta-font-size)', maxWidth: '46%' }}
        >
          {peer.workspace}
        </span>
      )}
      {muted && mutedIcon}
      {hasUnreadMention && (
        <span
          aria-label="You were mentioned"
          title="You were mentioned"
          style={{
            height: 'var(--sidebar-badge-size)',
            width: 'var(--sidebar-badge-size)',
            fontSize: 'var(--sidebar-meta-font-size)',
          }}
          className={`shrink-0 rounded-full bg-active/20 text-active font-bold leading-none flex items-center justify-center ${metaFade}`}
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
          className={`shrink-0 px-1.5 rounded-full bg-active text-bg font-semibold leading-none flex items-center justify-center ${metaFade}`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
    {pinnedOverlay}
    {rowActions}
    </div>
  )
}
