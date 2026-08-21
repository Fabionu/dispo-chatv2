import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Info,
  MailOpen,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { Group } from '../lib/types'
import { groupLabel, groupPreview, isUnread, tractorPlate, trailerPlate } from '../lib/types'
import { useDraft } from '../lib/draftStorage'
import { getOps, tripSummary } from '../lib/vehicleOps'
import { RowActionsTrigger, RowMeta, RowStateIcon } from './sidebarBits'
import { initials } from '../components/messages/messageUtils'
import { MENU_GLYPH } from '../components/menuStyles'
import { statusMeta } from '../lib/availability'
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

// One conversation in the unified rail — two lines, no avatar.
//
// The identity slot (circular Avatar for a DM, squircle GroupAvatar for a
// vehicle room) was removed 2026-08-20: it encoded TYPE by shape, but it cost
// ~50px of a rail that is now 380px wide, and it said nothing a dispatcher
// scans for. Line 2 does that job instead — for a vehicle room with a trip it
// reads `SV 14 HLS │ RO→IT` (plate, then the trip's country corridor), which
// identifies the room AND tells you what it's doing.
//
// Line 2 falls back to the last-message preview when there are no operational
// facts to show, and DMs keep the preview outright: between a colleague's
// company name and what they just said, what they said is the point. Live
// states (someone typing, an unsent draft) override either.
//
// Line 1 is the name — with a DM peer's presence disc immediately after it —
// plus the last-activity stamp at the far right. Pin/mute/mention/unread
// indicators sit at the end of line 2 and slide left on hover to expose the
// actions arrow.
export default function GroupRow({
  group,
  typingUsers,
  selected,
  online,
  currentUserId,
  actionsOpen,
  onActionsOpenChange,
  onClick,
  onTogglePin,
  onToggleArchive,
  onToggleMute,
  onMarkRead,
  onMarkUnread,
  onDelete,
  onViewDetails,
}: {
  group: Group
  typingUsers: TypingUser[]
  selected: boolean
  // Live online user-id set (presence). Drives the DM status dot.
  online: Set<string>
  // Viewing user — decides the "You:" / name prefix on the preview line.
  currentUserId: string
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
  // Opens the conversation's details surface: the peer's profile for a direct
  // message, Group info for a vehicle room. The row only signals intent — the
  // workspace selects the conversation and the chat opens the right panel.
  onViewDetails: (group: Group) => void
}) {
  // A DM peer's dot: their declared status colour when online, dim grey when
  // offline (signed out / app closed). Live via socket presence.
  const peer = group.type === 'direct' ? group.directPeer : null
  const peerOnline = peer ? online.has(peer.id) : false
  // ONLINE ONLY. It used to render for every DM — the peer's status colour when
  // online, a grey OFFLINE disc otherwise — which meant a rail full of identical
  // grey dots carrying no information at all. Absence of a dot IS the offline
  // state, which is how every other chat app reads it.
  const peerDot =
    peer && peerOnline ? statusMeta(peer.availabilityStatus ?? 'available') : null
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

  // The mono meta line's facts, in scan order: what this vehicle IS, then what
  // it is DOING. Only vehicle rooms produce any — a DM's most useful second
  // line is still the last thing the person said, not their company name.
  //
  // The corridor is the trip's first and last country codes (`RO→IT`), which is
  // how dispatchers talk about a run. It collapses to one code for a domestic
  // trip and falls back to the status label when the stops carry no countries,
  // so the segment is never an empty arrow.
  const corridor = (() => {
    if (!trip) return null
    const codes = trip.routePlaces.map((p) => p.code).filter(Boolean) as string[]
    if (codes.length === 0) return trip.statusLabel
    const from = codes[0]
    const to = codes[codes.length - 1]
    return from === to ? from : `${from}→${to}`
  })()
  const metaSegments =
    group.type === 'vehicle'
      ? [tractorPlate(group) ?? trailerPlate(group), corridor].filter(Boolean).map(String)
      : []
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
  // Both lines' metadata slide left on hover/open, clearing the column the
  // actions arrow occupies. 28px, not the trigger's own 20px: at exactly one
  // slot the timestamp cleared the arrow by 2px and still read as touching it.
  // Line 1 (status dot + time) has to move as well as line 2 — the arrow is
  // centred between them, so shifting only one still left it colliding.
  const metaShift = `min-w-5 justify-end transition-transform duration-200 ease-out group-hover/row:-translate-x-7 group-focus-within/row:-translate-x-7${
    menuOpen ? ' -translate-x-7' : ''
  }`
  // The menu's read/unread label reflects the ACTUAL stored unread, not the
  // selected→0 view used for the badge.
  const actuallyUnread = (group.unreadCount ?? 0) > 0
  const ICON = MENU_GLYPH
  const isDirect = group.type === 'direct'
  // Labels stay SHORT: the cells share the rail's width, so "Mark as read"
  // becomes "Read". The aria-label carries the full wording.
  const rowMenuActions: RowAction[] = [
    // Leads the strip: the one purely informational action, and the reason most
    // people open this menu. Its meaning follows the conversation type — a DM
    // has a person behind it, a vehicle room has a truck.
    //
    // A DM's cell carries the peer's INITIALS rather than a contact glyph, for
    // the same reason the row's own avatar does (Avatar's `fallback="initials"`
    // above): a glyph depicts someone, whereas initials name WHICH someone the
    // action targets. Sized to the same 14px box as the lucide glyphs beside it,
    // and inheriting currentColor, so the strip's rhythm and hover states are
    // unchanged.
    {
      key: 'details',
      label: isDirect ? 'Profile' : 'Info',
      title: isDirect ? 'View user profile' : 'View group info',
      icon: isDirect ? (
        <span
          aria-hidden
          className="flex h-3.5 items-center justify-center text-base font-semibold leading-none tracking-tight"
        >
          {initials(peer?.name ?? groupLabel(group))}
        </span>
      ) : (
        <Info {...ICON} />
      ),
      onSelect: () => onViewDetails(group),
    },
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
      style={{ right: 'var(--sidebar-row-pad-x)' }}
      // Vertically CENTRED, not bottom-anchored. It used to sit on the
      // preview line's baseline, which was fine while rows were ~66px tall —
      // once they shrank to ~46px the trigger ended up a few pixels under the
      // timestamp and the two read as one smudged control. Centred, it owns a
      // column of its own that both metadata clusters slide clear of.
      className={`absolute top-1/2 -translate-y-1/2 z-10 transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto ${
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
        className={`w-full flex items-center text-left transition-colors border-l-2 ${
          selected
            ? 'border-text bg-white/10 text-text'
            : 'border-transparent text-muted hover:bg-white/8 hover:text-text'
        }`}
      >
        {/* Two-line body. Line 1: name + vehicle trip status + timestamp. Line 2:
            last-message preview + conversation-state icons. Tight line-height
            groups the two lines into one block, vertically centred by the avatar. */}
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          {/* Line 1 — name/status take the flexible space; timestamp stays at the
              far right, aligned with the identity rather than the preview. */}
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              {/* Sans. The name is the row's CONTENT; the plate and corridor
                  under it are its structure, and only structure speaks mono.
                  Setting the name in mono too made every row read as a serial
                  number instead of a conversation. */}
              <span
                className={`min-w-0 shrink truncate leading-tight ${
                  unread ? 'text-text font-semibold' : 'text-text/90 font-medium'
                }`}
                style={{ fontSize: 'var(--sidebar-conv-font-size)' }}
              >
                {groupLabel(group)}
              </span>
              {/* The peer's presence, TRAILING the name — it belongs to the
                  person, so it reads as part of their identity rather than as
                  another piece of right-edge metadata beside the clock. It sat
                  at the right end while it was grouped with the timestamp, and
                  before that it LED the name, which pushed every DM's name
                  ~10px right of every room's and gave the list two left edges.
                  Trailing keeps the left edge common to every row.
                  `self-center` against the baseline row: the disc has no
                  baseline worth aligning, so it centres on the middle of the
                  name's line box instead of hanging off its baseline. */}
              {peerDot && (
                <span
                  title={peerDot.label}
                  aria-label={peerDot.label}
                  className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
                  style={{ backgroundColor: peerDot.color }}
                />
              )}
            </span>
            {/* The timestamp shares line 2's shift, so the actions arrow always
                has a clear column between the two metadata clusters. */}
            <span className={`flex items-center gap-2 shrink-0 ${metaShift}`}>
              {/* Mono: the timestamp is structure, not content, and the rework
                  sets all structure in the mono face. Tabular figures also stop
                  the column jittering as times change width. */}
              {time && <span className="eyebrow shrink-0 leading-tight">{time}</span>}
            </span>
          </span>
          {/* Line 2 — operational facts in mono, or human text in sans. Live
              states win, then the mono meta, then the message preview. State
              icons sit inline at the right and slide left on hover/open,
              exposing the arrow menu. */}
          <span className="flex items-center gap-2">
            {metaSegments.length > 0 && !typingText && !showDraft ? (
              // `tripLineFull` carries the status plus the next stop — more than
              // the two-segment line can show, so it rides along as the tooltip
              // rather than being dropped.
              <span className="min-w-0 flex-1" title={tripLineFull ?? undefined}>
                <RowMeta segments={metaSegments} />
              </span>
            ) : (
              <span
                className={`flex-1 min-w-0 truncate leading-tight ${typingText ? 'text-active font-medium' : unread ? 'text-text/80' : 'text-muted'}`}
                style={{ fontSize: 'var(--sidebar-conv-meta-font-size)' }}
              >
                {typingText ? (
                  <span role="status" aria-live="polite">{typingText}</span>
                ) : showDraft ? (
                  // A local unsent draft takes over the line, its "Draft:" tag
                  // in the app's accent so it reads as a distinct, personal
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
            )}
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
            className={`mb-1 flex w-full origin-top items-stretch transition-[opacity,transform] duration-150 ease-out ${
              menuOpen
                ? 'action-strip-enter opacity-100 translate-y-0 scale-100'
                : 'opacity-0 -translate-y-1 scale-[0.98]'
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
