import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { groupLabel, groupPreview, isUnread } from '../lib/types'
import { useDraft } from '../lib/draftStorage'
import { getOps, tripSummary } from '../lib/vehicleOps'
import { TripStatusInline } from '../components/vehicle/opsControls'
import Avatar from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'
import IdentitySlot from '../components/IdentitySlot'
import { RowActionsTrigger, RowStateIcon } from './sidebarBits'
import { MENU_GLYPH } from '../components/menuStyles'
import { statusMeta, OFFLINE } from '../lib/availability'
import { typingStatusText, type TypingUser } from '../lib/typing'

// One cell in a row's inline action strip. `label` is the short form shown
// under the glyph; `title` is the full wording (tooltip + accessible name).
type RowAction = {
  key: string
  label: string
  title: string
  icon: ReactNode
  onSelect: () => void
  // Destructive styling (alert colour).
  danger?: boolean
  // When set, the FIRST click swaps the cell to this label and a second click
  // runs onSelect — an inline confirmation, no separate modal.
  confirmLabel?: string
}

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
// quiet tone-coloured text, followed by the last-activity timestamp. The preview
// line carries pin/mute/mention/unread state; those indicators slide left on
// hover to expose the downward actions arrow without covering the preview.
export default function GroupRow({
  group,
  typingUsers,
  selected,
  online,
  currentUserId,
  size,
  actionsOpen,
  onActionsOpenChange,
  onClick,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMarkRead,
  onMarkUnread,
  onDelete,
}: {
  group: Group
  typingUsers: TypingUser[]
  selected: boolean
  // Live online user-id set (presence). Drives the DM status dot.
  online: Set<string>
  // Viewing user — decides the "You:" / name prefix on the preview line.
  currentUserId: string
  // Identity-slot diameter in design px (tracks display density).
  size: number
  // Whether THIS row's action strip is expanded. Owned by the list so only one
  // row can be open at a time.
  actionsOpen: boolean
  onActionsOpenChange: (open: boolean) => void
  onClick: () => void
  // Per-conversation row actions (the inline strip). Each takes the row's group
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
  const unread = selected ? false : isUnread(group)
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
  // synced). It is persisted while typing, but only replaces the last-message
  // preview after the user leaves this conversation. This keeps the active
  // sidebar row stable while the composer is being used.
  const draft = useDraft(currentUserId, group.id).replace(/\s+/g, ' ').trim()
  const showDraft = !selected && Boolean(draft)
  const typingText = typingStatusText(typingUsers, group.type === 'direct')

  // ── Per-conversation row actions (inline strip under the row) ─────────────
  // Opening them expands a horizontal action bar directly beneath THIS row
  // rather than floating a popover over the rail: the actions stay tied to the
  // conversation they belong to, and nothing covers the rest of the list.
  // While it's open the row stays in its "actions active" state — the trigger
  // stays visible and the preview-line indicators remain shifted left even
  // after the cursor leaves the row.
  const menuOpen = actionsOpen
  // Two-step inline confirm for the destructive action (no separate modal).
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Collapsing (including when ANOTHER row takes over) always re-arms delete.
  useEffect(() => {
    if (!menuOpen) setConfirmDelete(false)
  }, [menuOpen])
  const closeActions = () => onActionsOpenChange(false)
  const rowWrapperRef = useRef<HTMLDivElement>(null)
  // Right-clicking anywhere on the row TOGGLES the same actions: once to open,
  // again to close. Right-clicking a DIFFERENT row moves the strip there (the
  // list owns the open id, so only one is ever open) — and the outside-press
  // handler below has already closed this one by the time that row's
  // contextmenu fires. `preventDefault` keeps the browser menu away, and a
  // contextmenu is not a click, so the conversation never opens from it.
  const toggleMenuAtCursor = (e: React.MouseEvent) => {
    e.preventDefault()
    onActionsOpenChange(!menuOpen)
  }
  // Escape and a press outside the row both close the strip, matching every
  // other dismissible surface. `mousedown` (not click) so it also fires for the
  // right button, which is what makes right-clicking another row hand over
  // cleanly.
  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onActionsOpenChange(false)
    }
    function onPointerDown(e: MouseEvent) {
      if (rowWrapperRef.current?.contains(e.target as Node)) return
      onActionsOpenChange(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [menuOpen, onActionsOpenChange])
  const archived = Boolean(group.archivedAt)
  const pinned = Boolean(group.pinnedAt)
  const muted = Boolean(group.muted)
  // Preview-line state slides left exactly one trigger slot on hover/open. The
  // indicators remain visible; the movement simply frees the far-right edge for
  // the downward actions arrow.
  const metaShift = `min-w-5 justify-end transition-transform duration-200 ease-out group-hover/row:-translate-x-5 group-focus-within/row:-translate-x-5${
    menuOpen ? ' -translate-x-5' : ''
  }`
  // The menu's read/unread label reflects the ACTUAL stored unread, not the
  // selected→0 view used for the badge.
  const actuallyUnread = (group.unreadCount ?? 0) > 0
  const ICON = MENU_GLYPH
  // Labels stay SHORT: five cells share the rail's width, so "Mark as read"
  // becomes "Read". The aria-label carries the full wording.
  const rowMenuActions: RowAction[] = [
    {
      key: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      title: pinned ? 'Unpin conversation' : 'Pin conversation',
      icon: pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />,
      onSelect: () => onTogglePin(group, !pinned),
    },
    {
      key: 'read',
      label: actuallyUnread ? 'Read' : 'Unread',
      title: actuallyUnread ? 'Mark as read' : 'Mark as unread',
      icon: <MailOpen {...ICON} />,
      onSelect: () => (actuallyUnread ? onMarkRead(group) : onMarkUnread(group)),
    },
    {
      key: 'mute',
      label: muted ? 'Unmute' : 'Mute',
      title: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? <Bell {...ICON} /> : <BellOff {...ICON} />,
      onSelect: () => onToggleMute(group, !muted),
    },
    {
      key: 'archive',
      label: archived ? 'Restore' : 'Archive',
      title: archived ? 'Unarchive conversation' : 'Archive conversation',
      icon: archived ? <ArchiveRestore {...ICON} /> : <Archive {...ICON} />,
      onSelect: () => onToggleArchive(group, !archived),
    },
    {
      key: 'delete',
      label: 'Delete',
      title: 'Delete conversation',
      icon: <Trash2 {...ICON} />,
      danger: true,
      confirmLabel: 'Sure?',
      onSelect: () => onDelete(group),
    },
  ]
  // On-hover/focus overlay holding the disclosure trigger at the right end of
  // the preview line. The inline indicators slide left to expose this slot.
  // Pointer events stay off until revealed so the hidden trigger never blocks
  // the row click.
  const rowActions = (
    <div
      style={{
        right: 'var(--sidebar-row-pad-x)',
        bottom: 'var(--sidebar-row-pad-y)',
      }}
      className={`absolute z-10 transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto ${
        menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <RowActionsTrigger
        open={menuOpen}
        label={`Conversation actions for ${groupLabel(group)}`}
        onToggle={() => onActionsOpenChange(!menuOpen)}
      />
    </div>
  )
  // Muted indicator — part of the preview-line state cluster, same glyph family
  // and tone as the pin above it.
  const mutedIcon = muted ? (
    <RowStateIcon icon={BellOff} label="Notifications muted" />
  ) : null

  return (
    <div ref={rowWrapperRef} className="relative group/row" onContextMenu={toggleMenuAtCursor}>
      {/* Anchor the disclosure trigger to the fixed-height conversation row.
          The outer wrapper also contains the expanding action strip. */}
      <div className="relative">
        <button
        onClick={onClick}
        style={{
          minHeight: 'var(--sidebar-row-height)',
          gap: 'var(--sidebar-row-gap)',
          paddingLeft: 'var(--sidebar-row-pad-x)',
          paddingRight: 'var(--sidebar-row-pad-x)',
          paddingTop: 'var(--sidebar-row-pad-y)',
          paddingBottom: 'var(--sidebar-row-pad-y)',
        }}
        className={`w-full flex items-center rounded-btn text-left transition-colors ${
          selected
            ? 'bg-white/10 text-text'
            : 'text-muted hover:bg-white/8 hover:text-text'
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
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar"
              style={{ backgroundColor: peerDot.color }}
            />
          )}
        </IdentitySlot>

        {/* Two-line body. Line 1: name + vehicle trip status + timestamp. Line 2:
            last-message preview + conversation-state icons. Tight line-height
            groups the two lines into one block, vertically centred by the avatar. */}
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          {/* Line 1 — name/status take the flexible space; timestamp stays at the
              far right, aligned with the identity rather than the preview. */}
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
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
                  className="shrink-[3] leading-tight opacity-75"
                  style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
                />
              )}
            </span>
            {time && (
              <span
                className="shrink-0 tabular-nums text-muted leading-tight"
                style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
              >
                {time}
              </span>
            )}
          </span>
          {/* Line 2 — the preview remains unchanged. State icons sit inline at
              the right and slide left on hover/open, exposing the arrow menu. */}
          <span className="flex items-center gap-2">
            <span
              className={`flex-1 min-w-0 truncate leading-tight ${typingText ? 'text-active font-medium' : unread ? 'text-text/80' : 'text-muted'}`}
              style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
            >
              {typingText ? (
                <span role="status" aria-live="polite">{typingText}</span>
              ) : showDraft ? (
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
                    <span className={unread ? 'text-text/80 font-medium' : 'text-muted'}>
                      {preview.prefix}{' '}
                    </span>
                  )}
                  {preview.text}
                </>
              )}
            </span>
            <span className={`flex items-center gap-2 shrink-0 ${metaShift}`}>
              {pinned && <RowStateIcon icon={Pin} label="Pinned" />}
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
            </span>
          </span>
        </span>
        </button>
        {rowActions}
      </div>

      {/* The actions themselves: a horizontal strip directly under this row.
          Animated with a 0fr→1fr grid row so the height transitions without a
          hard-coded max-height, and kept out of the tab order while closed. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          menuOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* No surface of its own: a tinted card under a row on the rail's
              near-black background reads as a different material. The cells run
              the row's full width and only light up on hover. */}
          <div
            role="group"
            aria-label={`Actions for ${groupLabel(group)}`}
            className={`mb-1 flex w-full items-stretch transition-opacity duration-150 ${
              menuOpen ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {rowMenuActions.map((a) => {
              const confirming = a.confirmLabel != null && confirmDelete
              const danger = a.danger || confirming
              return (
                <button
                  key={a.key}
                  type="button"
                  tabIndex={menuOpen ? 0 : -1}
                  aria-label={confirming ? `${a.title} — confirm` : a.title}
                  title={a.title}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (a.confirmLabel && !confirmDelete) {
                      setConfirmDelete(true)
                      return
                    }
                    closeActions()
                    a.onSelect()
                  }}
                  className={`flex-1 min-w-0 flex flex-col items-center gap-1 rounded-btn px-1 py-1.5 transition-colors ${
                    danger ? 'text-alert hover:bg-alert/10' : 'text-muted hover:bg-white/6 hover:text-text'
                  }`}
                >
                  {a.icon}
                  <span className="text-2xs leading-none truncate max-w-full">
                    {confirming ? a.confirmLabel : a.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
