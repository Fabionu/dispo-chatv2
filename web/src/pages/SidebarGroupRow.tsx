import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
  User,
} from 'lucide-react'
import type { Group } from '../lib/types'
import { groupLabel, groupPreview, isUnread, tractorPlate, trailerPlate } from '../lib/types'
import { useDraft } from '../lib/draftStorage'
import { getOps, placeTown, tripSummary } from '../lib/vehicleOps'
import { TONE_TEXT } from '../components/vehicle/opsControls'
import {
  RowActionsTrigger,
  RowMeta,
  RowStateIcon,
  RowTile,
  UnreadBadge,
  unreadLabel,
} from './sidebarBits'
import {
  MENU_CONTAINER,
  MENU_GLYPH,
  MENU_SEPARATOR,
  menuIconClass,
  menuItemClass,
} from '../components/menuStyles'
import { statusMeta } from '../lib/availability'
import { typingLabel, type TypingUser } from '../lib/typing'
import TypingMark from '../components/messages/TypingMark'

// A direct message's picture, in design px: bigger than the 38px room tile
// (SIDEBAR_TILE_PX) because a DM is recognised by a face, not by a plate.
const DM_TILE_PX = 44

// One item in a row's actions list. `label` is the wording shown in the list;
// `title` is the full sentence for the accessible name.
type RowAction = {
  key: string
  label: string
  title: string
  icon: ReactNode
  onSelect: () => void
  // Destructive styling (alert colour).
  danger?: boolean
  // When set, the FIRST click swaps the item to this label and a second click
  // runs onSelect — an inline confirmation, no separate modal.
  confirmLabel?: string
  // A hairline above this item — where the list changes kind (settings above,
  // archive and delete below).
  separatorBefore?: boolean
}

// The nearest scrolling ancestor, or null for the page: the box a row's list has
// to fit inside, which is what decides whether it opens below the row or above.
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
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

// One conversation in the unified rail. A person: an identity tile and two
// lines. A vehicle room (rework, 2026-10-29): no tile, three lines — plate,
// trip, last message (see below).
//
// The tile came back on 2026-08-26 (user) after six days without one. What it
// is NOT is the old identity slot: that one encoded the conversation's TYPE by
// its shape (circle = person, squircle = room), and line 2 does that job now —
// for a vehicle room with a trip it reads `SV 14 HLS │ RO→IT` (plate, then the
// trip's country corridor), which identifies the room AND tells you what it's
// doing, in less space than a silhouette. The tile is back for the thing the
// meta line CAN'T do: a face is recognised before it is read. See RowTile.
//
// Line 2 is the last-message preview for EVERY conversation (user,
// 2026-09-23: group rows should show it too). Live states (someone typing, an
// unsent draft) override it.
//
// Line 1 is the name — with a DM peer's presence disc, or a vehicle room's
// plate │ corridor in the label voice, immediately after it — plus the
// last-activity stamp at the far right. The plate and corridor used to OWN
// line 2, which meant a vehicle room never showed what was said in it; they
// moved up rather than going to a third line so every row keeps one height. Pin/mute/mention/unread
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
  const tripPct = Math.max(0, Math.min(1, trip?.progress?.pct ?? 0))

  const preview = groupPreview(group, currentUserId)
  const time = relTime(group.lastMessageAt)

  // A DM carries the person's company in the same slot and voice as a room's
  // plate (rework canvas, user 2026-10-12: "the same look for the dm's") —
  // with people from partner companies in the list, "who is this, and from
  // where" is the question line 1 has to answer.
  //
  // A vehicle room is titled by its PLATE (user, 2026-10-29 canvas) — that is
  // what a dispatcher scans for — with the room's own name after it in the
  // label voice, when the two differ.
  const isVehicle = group.type === 'vehicle'
  const plate = isVehicle ? tractorPlate(group) ?? trailerPlate(group) : null
  const rowTitle = plate ?? groupLabel(group)
  const metaSegments = isVehicle
    ? plate && plate !== groupLabel(group)
      ? [groupLabel(group)]
      : []
    : peer?.workspace
      ? [peer.workspace]
      : []
  // The trip line's two ends and its figure: the stop being driven to (or the
  // first stop once that is the last one), the final stop, and how far along
  // the truck is — the status word before it has left or once it has arrived.
  const tripEnds = (() => {
    if (!trip || trip.stops.length === 0) return null
    const last = trip.stops.length - 1
    const next = trip.stops.findIndex((s) => s.status === 'planned')
    const left = next >= 0 && next < last ? next : 0
    return {
      from: placeTown(trip.stops[left].place),
      to: last > 0 ? placeTown(trip.stops[last].place) : null,
    }
  })()
  const tripFigure =
    trip && trip.progress && tripPct > 0 && tripPct < 1 ? `${Math.round(tripPct * 100)}%` : trip?.statusLabel
  // Local unsent draft for THIS conversation (this user/device only — never
  // synced). It is persisted while typing, but only replaces the last-message
  // preview after the user leaves this conversation. This keeps the active
  // sidebar row stable while the composer is being used.
  const draft = useDraft(currentUserId, group.id).replace(/\s+/g, ' ').trim()
  const showDraft = !selected && Boolean(draft)
  const typingText = typingLabel(typingUsers, group.type === 'direct')

  // ── Per-conversation row actions (a named list under the row) ─────────────
  // The "⋯" opens a list of named actions anchored to THIS row's right edge
  // (user, 2026-10-30: it was a strip of six icon-and-label cells that
  // pushed the rail down, and the labels had to be squeezed to "Read"/"Unread").
  // It floats over the rows beneath it like every other action menu, below the
  // row — or above it when the rail has no room left underneath.
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
  const menuRef = useRef<HTMLDivElement>(null)
  // Opens upward when there is no room below the row inside the rail's scroller
  // (the last rows of a short list) but room above it. Measured before paint, so
  // the list never flashes in the wrong place.
  const [flipUp, setFlipUp] = useState(false)
  useLayoutEffect(() => {
    const menu = menuRef.current
    const wrap = rowWrapperRef.current
    if (!menuOpen || !menu || !wrap) {
      setFlipUp(false)
      return
    }
    const port = scrollParentOf(wrap)
    const bounds = port?.getBoundingClientRect()
    const top = bounds?.top ?? 0
    const bottom = bounds?.bottom ?? window.innerHeight
    const row = wrap.getBoundingClientRect()
    const need = menu.offsetHeight + 8
    setFlipUp(bottom - row.bottom < need && row.top - top > need)
  }, [menuOpen])
  // Right-clicking anywhere on the row TOGGLES the same actions: once to open,
  // again to close. Right-clicking a DIFFERENT row moves the list there (the
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
  // Named actions, in the wording the list can afford (the strip had to squeeze
  // "Mark as read" into "Read"). The icons stay the lucide set; a DM's
  // profile entry takes a person glyph where the strip drew the peer's initials,
  // because a list row has the name in the row above it already.
  const rowMenuActions: RowAction[] = [
    // Leads the list: the one purely informational action, and the reason most
    // people open this menu. Its meaning follows the conversation type — a DM
    // has a person behind it, a vehicle room has a truck.
    {
      key: 'details',
      label: isDirect ? 'View profile' : 'View group info',
      title: isDirect ? 'View user profile' : 'View group info',
      icon: isDirect ? <User {...ICON} /> : <Info {...ICON} />,
      onSelect: () => onViewDetails(group),
    },
    {
      key: 'pin',
      label: pinned ? 'Unpin from top' : 'Pin to top',
      title: pinned ? 'Unpin conversation' : 'Pin conversation',
      icon: pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />,
      onSelect: () => onTogglePin(group, !pinned),
    },
    {
      key: 'read',
      label: actuallyUnread ? 'Mark as read' : 'Mark as unread',
      title: actuallyUnread ? 'Mark as read' : 'Mark as unread',
      icon: <MailOpen {...ICON} />,
      onSelect: () => (actuallyUnread ? onMarkRead(group) : onMarkUnread(group)),
    },
    {
      key: 'mute',
      label: muted ? 'Unmute notifications' : 'Mute notifications',
      title: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? <Bell {...ICON} /> : <BellOff {...ICON} />,
      onSelect: () => onToggleMute(group, !muted),
    },
    {
      key: 'archive',
      label: archived ? 'Restore from archive' : 'Archive',
      title: archived ? 'Unarchive conversation' : 'Archive conversation',
      icon: archived ? <ArchiveRestore {...ICON} /> : <Archive {...ICON} />,
      onSelect: () => onToggleArchive(group, !archived),
      separatorBefore: true,
    },
    {
      key: 'delete',
      label: 'Delete conversation',
      title: 'Delete conversation',
      icon: <Trash2 {...ICON} />,
      danger: true,
      confirmLabel: 'Sure? Delete it',
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

  // The row's state marks — pin, mention, unread count or dot, muted. One piece,
  // two homes: at the right end of the preview line for rooms, and under the
  // time in the right-hand column of a DM row (see `isDirect` below).
  const stateCluster = (
    <>
      {pinned && <RowStateIcon icon={Pin} label="Pinned" />}
      {hasUnreadMention && (
        <UnreadBadge tone="mention" label="You were mentioned">
          @
        </UnreadBadge>
      )}
      {unread && hasCount && unreadCount > 0 && (
        <UnreadBadge label={`${unreadCount} unread`}>{unreadLabel(unreadCount)}</UnreadBadge>
      )}
      {/* Unread, but the server sent no number to put in a badge (see
          `hasCount`). A dot, not an empty chip — a chip's whole shape is "there
          is a figure in here". */}
      {unread && !hasCount && (
        <span
          role="img"
          aria-label="Unread"
          title="Unread"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-text"
        />
      )}
      {mutedIcon}
    </>
  )
  // The DM row's right-hand column slides left on hover/open exactly like the
  // room rows' metadata does (metaShift), but it is a vertical stack, so it
  // must not inherit that string's `justify-end` (which would sink it to the
  // bottom of the row).
  const dmShift = `min-w-5 transition-transform duration-200 ease-out group-hover/row:-translate-x-7 group-focus-within/row:-translate-x-7${
    menuOpen ? ' -translate-x-7' : ''
  }`

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
        // `aria-current` is what the rail's travelling bar measures to find
        // this row — and it is the correct thing for a selected navigation item
        // to say regardless.
        aria-current={selected ? 'true' : undefined}
        // The 2px left border stays TRANSPARENT in both states: it reserves the
        // channel the travelling bar slides down (see Workspace's rail list) so
        // selecting a row never shifts its text by two pixels. The row still
        // owns its wash and its text colour; only the rule moved out, because a
        // border that belongs to the row can only appear and disappear, and the
        // point is for it to travel.
        //
        // ROUNDED as of 2026-09-06 (user). The hover/selected wash was the last
        // sharp-cornered rectangle in a rounded app. `rounded-card` matches the
        // identity tile inside the row, and the `<nav>` already insets the list
        // by `px-1.5`, so the corners have background to sit against rather than
        // dying into the rail's edge.
        className={`w-full flex items-center rounded-card text-left transition-colors border-l-2 border-transparent ${
          selected ? 'bg-white/5 text-text' : 'text-muted hover:bg-white/8 hover:text-text'
        }`}
      >
        {/* The picture: the peer for a DM, the room's own image for a vehicle
            group. It rides the button's existing `--sidebar-row-gap`, which has
            been the identity slot's gutter all along. */}
        {/* Vehicle rooms carry no picture (user, 2026-10-29 canvas): the plate
            leads the row and the trip line under it does the identifying, so
            people keep the only faces in the rail. */}
        {isVehicle ? null : isDirect ? (
          // A DM is faces first (user, 2026-10-30, canvas option D): a 44px
          // picture, with the peer's presence on its corner — it belongs to the
          // person, and a corner dot is where every messenger puts it. Rooms
          // keep the 38px tile and the trailing dot.
          <span className="relative shrink-0">
            <RowTile
              kind="user"
              id={peer?.id ?? ''}
              name={groupLabel(group)}
              hasAvatar={peer?.hasAvatar}
              version={peer?.avatarVersion}
              size={DM_TILE_PX}
            />
            {peerDot && (
              <span
                title={peerDot.label}
                aria-label={peerDot.label}
                className="absolute -bottom-px -right-px h-[0.6875rem] w-[0.6875rem] rounded-full border-2 border-bg"
                style={{ backgroundColor: peerDot.color }}
              />
            )}
          </span>
        ) : (
          <RowTile kind="group" id={group.id} hasAvatar={group.hasAvatar} version={group.avatarVersion} />
        )}
        {/* Two-line body. Line 1: name + vehicle trip status + timestamp. Line 2:
            last-message preview + conversation-state icons. Tight line-height
            groups the two lines into one block, vertically centred by the tile. */}
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          {/* Line 1 — name/status take the flexible space; timestamp stays at the
              far right, aligned with the identity rather than the preview. */}
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              {/* The name is the row's CONTENT; the plate and corridor under
                  it are its structure, and structure is what the small faint
                  label voice is for. Setting the name in that voice too made
                  every row read as a serial number instead of a conversation. */}
              <span
                // 400 read / 500 unread (user, 2026-10-30: the "lighter" names
                // from the typeface canvas) — it was 500 / 600. Unread still
                // reads as heavier than read, one step apart as before.
                className={`min-w-0 shrink truncate leading-tight ${
                  unread ? 'text-text font-medium' : 'text-text/90 font-normal'
                }`}
                style={{
                  fontSize: isDirect
                    ? 'calc(var(--sidebar-conv-font-size) + 1px)'
                    : 'var(--sidebar-conv-font-size)',
                }}
              >
                {isVehicle ? <span className="tabular-nums">{rowTitle}</span> : rowTitle}
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
              {peerDot && !isDirect && (
                <span
                  title={peerDot.label}
                  aria-label={peerDot.label}
                  className="h-1.5 w-1.5 shrink-0 self-center rounded-full"
                  style={{ backgroundColor: peerDot.color }}
                />
              )}
              {/* Plate │ corridor, beside the name. The name takes the room
                  it needs; this gets what is left and shows only the
                  segments that fit whole (RowMeta `whole`), so on a narrow
                  rail the structure gives way before the content does.
                  `tripLineFull` (status + next stop) rides along as the
                  tooltip. */}
              {metaSegments.length > 0 && (
                <span className="flex min-w-0 flex-1" title={tripLineFull ?? undefined}>
                  <RowMeta segments={metaSegments} whole />
                </span>
              )}
            </span>
            {/* The timestamp shares line 2's shift, so the actions arrow always
                has a clear column between the two metadata clusters. */}
            {!isDirect && (
              <span className={`flex items-center gap-2 shrink-0 ${metaShift}`}>
                {/* `.timestamp`: structure, not content. Tabular figures stop the
                    column jittering as times change width. */}
                {time && <span className="timestamp shrink-0 leading-tight">{time}</span>}
              </span>
            )}
          </span>
          {/* Vehicle rooms only — the trip, between the plate and what was said
              (user, 2026-10-29 canvas): the town being driven to, the trip as a
              hairline with the truck as a dot on it, the final town, and how
              far along it is. A room WITHOUT a trip draws no line at all (user,
              2026-10-30: "if there is no trip, don't show the badge"), so the
              rows that have one stand out. Pulls in from the right on
              hover/open like the lines around it. */}
          {isVehicle && trip && tripEnds && (
            <span
              className={`my-1 flex min-w-0 items-center gap-2 text-xs leading-tight transition-[margin] duration-200 ease-out group-hover/row:mr-7 group-focus-within/row:mr-7 ${
                menuOpen ? 'mr-7' : ''
              }`}
              title={tripLineFull ?? undefined}
            >
              <>
                  <span className="max-w-[34%] shrink-0 truncate font-medium text-text/85">{tripEnds.from}</span>
                  <span aria-hidden className={`relative h-0.5 min-w-10 flex-1 rounded-full bg-line ${TONE_TEXT[trip.statusTone]}`}>
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-current"
                      style={{ width: `${tripPct * 100}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
                      style={{ left: `${tripPct * 100}%` }}
                    />
                  </span>
                  {tripEnds.to && (
                    <span className="max-w-[34%] shrink-0 truncate font-medium text-text/85">{tripEnds.to}</span>
                  )}
                  <span className={`shrink-0 font-semibold tabular-nums ${TONE_TEXT[trip.statusTone]}`}>{tripFigure}</span>
              </>
            </span>
          )}
          {/* Line 2 — human text at reading size: typing wins, then a draft,
              then the last-message preview. State icons sit inline at the right
              and slide left on hover/open, exposing the arrow menu. */}
          <span className="flex items-center gap-2">
            <span
              className={`flex-1 min-w-0 truncate leading-tight ${typingText ? 'text-active font-medium' : unread ? 'text-text/80' : 'text-muted'}`}
              style={{
                fontSize: isDirect
                  ? 'calc(var(--sidebar-conv-meta-font-size) + 0.5px)'
                  : 'var(--sidebar-conv-meta-font-size)',
              }}
            >
              {typingText ? (
                // The mark leads and the sentence follows — and it is the
                // sentence that truncates, so the mark never gets cut. A flex
                // line rather than inline content for the same reason.
                <span role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
                  <TypingMark />
                  <span className="truncate">{typingText}</span>
                </span>
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
            {!isDirect && (
              <span className={`flex items-center gap-2 shrink-0 ${metaShift}`}>{stateCluster}</span>
            )}
          </span>
        </span>
        {/* A DM's right-hand column: the time over the state marks, stacked and
            right-aligned (canvas option D). Slides left on hover/open like the
            metadata of every other row, clearing the actions trigger. */}
        {isDirect && (
          <span className={`flex shrink-0 flex-col items-end justify-center gap-1.5 ${dmShift}`}>
            {time && <span className="timestamp shrink-0 leading-tight">{time}</span>}
            <span className="flex items-center gap-2 empty:hidden">{stateCluster}</span>
          </span>
        )}
        </button>
        {rowActions}
      </div>

      {/* The actions themselves: a named list hanging from the row's right
          edge — the shared action-menu surface, rendered only while open, so
          nothing in it is in the tab order when closed. Floats over the rows
          below (or above, see `flipUp`) instead of moving them. */}
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${groupLabel(group)}`}
          className={`${MENU_CONTAINER} absolute right-2 z-30 w-56 ${
            flipUp
              ? 'action-strip-enter-up bottom-full mb-1 origin-bottom'
              : 'action-strip-enter top-full mt-1 origin-top'
          }`}
        >
          {rowMenuActions.map((a) => {
            const confirming = a.confirmLabel != null && confirmDelete
            const tone = a.danger || confirming ? 'danger' : 'default'
            return (
              <Fragment key={a.key}>
                {a.separatorBefore && <div role="separator" className={MENU_SEPARATOR} />}
                <button
                  type="button"
                  role="menuitem"
                  aria-label={confirming ? `${a.title} — confirm` : a.title}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Delete asks once, in place: the first click re-labels the
                    // item, the second one does it.
                    if (a.confirmLabel && !confirmDelete) {
                      setConfirmDelete(true)
                      return
                    }
                    closeActions()
                    a.onSelect()
                  }}
                  className={`${menuItemClass(tone)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20`}
                >
                  <span aria-hidden className={menuIconClass(tone)}>
                    {a.icon}
                  </span>
                  {confirming ? a.confirmLabel : a.label}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
