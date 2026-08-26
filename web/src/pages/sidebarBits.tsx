// Small presentational bits for the workspace sidebar: the unread mark, the
// unified-list filter pill, the empty-list hint, and the two menu-item styles
// (user menu + the create/options menu). Kept together so the rail's row/menu
// chrome lives in one place — which is also what lets the rail's three unread
// readouts share one mark instead of drifting into three.

import { Fragment, type ReactNode } from 'react'
import { useTravellingMarker } from '../components/useTravellingMarker'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { menuIconClass, menuItemClass } from '../components/menuStyles'
import Avatar from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'

// ── Row identity tile ───────────────────────────────────────────────────────
// The picture at the head of a rail row: a person's photo for a DM or a
// colleague, the room's image for a vehicle group.
//
// The rail carried no picture at all between 2026-08-20 and 2026-08-26. The
// argument then was that a 40px portrait cost ~50px of a rail that had just
// narrowed to 380px, and that the mono meta line under the name (`SV 14 HLS │
// RO→IT`) identifies a room better than a silhouette does. The second half of
// that is still true and the meta line stays — but it was answering the wrong
// question. A plate tells you WHICH TRUCK; a face tells you WHO, and it does it
// pre-attentively, before any text is read. In a list you scan dozens of times
// an hour that is the difference between reading the rail and glancing at it.
//
// SQUARE, like the thread's author tile. `tailwind.config.js` does still allow
// `rounded-full` for a photo, so a disc here would not be a violation — but the
// same person's photo appears in the rail and in the message timeline, often at
// the same moment, and one object with two silhouettes is worse than one
// deviation from a general rule.
//
// 38px (user, 2026-08-26 — "can be bigger"). It started at 30 to match the
// thread tile and cost the row nothing, since a two-line row is already ~33px of
// text inside a 44px minimum. 38 does grow the row by a few pixels, which is the
// trade being made deliberately: the rail is a SCANNING surface read dozens of
// times an hour and the thread is a reading one, so the picture that has to be
// recognisable at a glance is this one, not the message tile. The rail also
// widened at the same time, so the extra width the tile takes is width the row
// just gained.
export const SIDEBAR_TILE_PX = 38

export function RowTile(
  props:
    // `hasAvatar` is optional on purpose. The roster types that carry it
    // (WorkspaceMember, Group) pass it and skip a doomed request; DirectPeer and
    // ConnectionUser do not carry it, and those fall back to asking and letting
    // the 404 flip them to the fallback. `avatarCache` remembers the failure, so
    // that costs one request per person per session, not one per render.
    | { kind: 'user'; id: string; name: string; hasAvatar?: boolean }
    | { kind: 'group'; id: string; hasAvatar?: boolean },
) {
  if (props.kind === 'group') {
    return (
      <GroupAvatar
        groupId={props.id}
        hasAvatar={props.hasAvatar}
        shape="rounded"
        size={SIDEBAR_TILE_PX}
      />
    )
  }
  return (
    <Avatar
      userId={props.id}
      name={props.name}
      hasAvatar={props.hasAvatar}
      size={SIDEBAR_TILE_PX}
      shape="square"
      // INITIALS, not the contact glyph. This is a LIST of people, which is the
      // case Avatar's `fallback` prop documents the opt-in for: a column of
      // identical silhouettes tells the eye nothing, whereas initials at least
      // name which person the row is about.
      fallback="initials"
    />
  )
}

// ── Conversation-row glyph spec ─────────────────────────────────────────────
// Pinned, muted and the actions trigger used to each carry their own size and
// stroke (13px/1.8, 12px/1.7, 12px/1.8), which is why they never quite lined up
// on a row. They are ONE family now: same lucide outline set, same optical box,
// same stroke, same tone. Sizes are rem so they track the UI scale.
export const ROW_GLYPH = { size: '0.8125rem', strokeWidth: 1.7 } as const

// A state indicator on the preview line (pinned, muted). Deliberately quieter
// than the unread badge — it reports a setting, it does not demand attention —
// and it is a labelled <span role="img"> so screen readers and tooltips both
// name it (a bare <svg aria-label> is not announced).
export function RowStateIcon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="shrink-0 inline-flex items-center justify-center text-faint"
    >
      <Icon {...ROW_GLYPH} aria-hidden />
    </span>
  )
}

// The row's actions trigger: the same chevron as the message bubble's, with the
// three states the rest of the app uses — idle (hidden until the row is hovered
// or focused), hover/focus (warms + fills), open (stays visible, flipped).
export function RowActionsTrigger({
  open,
  label,
  onToggle,
}: {
  open: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        // Never let the click fall through to the row (which opens the chat).
        e.stopPropagation()
        e.preventDefault()
        onToggle()
      }}
      className={`h-5 w-5 flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        open ? 'bg-white/8 text-text' : 'text-muted hover:text-text hover:bg-white/6'
      }`}
    >
      <ChevronDown
        {...ROW_GLYPH}
        aria-hidden
        className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
          open ? 'rotate-180' : ''
        }`}
      />
    </button>
  )
}

// ── The unread mark ─────────────────────────────────────────────────────────
// The rail reports unread in three places — the Unread filter tab, a row's
// count, a row's @-mention — and they were three unrelated shapes: a square sans
// chip on the tab, a 23px WHITE DISC on the row, a tinted disc for the mention.
// Three marks for one idea, and the two on the row were the only circles in a
// rail otherwise drawn entirely from squares and hairlines (see the radius scale
// in tailwind.config.js: `rounded-full` survives for photos, presence dots and
// sliding tracks — a count is none of those).
//
// So: ONE mark, square, set in the mono voice with tabular figures, in three
// tones and two sizes.
//   count   — the neutral solid. The loudest thing in the rail, which is correct:
//             it is the only element whose whole job is to be noticed.
//   mention — the same block in the accent. Being named outranks ordinary
//             traffic, and colour is what says so; it used to be a 20%-alpha
//             tint, which read as quieter than the plain count sitting next to
//             it and inverted the hierarchy.
//   quiet   — the tab's count while that tab is not selected.
//
// Letter-spacing is reset to NORMAL on the badge itself — the same call
// `.eyebrow-time` makes in index.css and for the same reason: a count is one
// value, not a word being spelled out. On the element rather than left to
// inherit, because the tab badge's parent IS an `.eyebrow` (0.14em), and tracked
// figures both read as separate things and sit off the centre of their box —
// tracking adds its space AFTER the last glyph, so `12` would hang left.
const BADGE_TONE = {
  count: 'bg-text text-bg',
  mention: 'bg-active text-bg',
  quiet: 'bg-white/10 text-muted',
} as const

export function UnreadBadge({
  tone = 'count',
  size = 'row',
  label,
  children,
}: {
  tone?: keyof typeof BADGE_TONE
  /** `row` sizes off the density token; `tab` off the type scale it sits in. */
  size?: 'row' | 'tab'
  /** Accessible name. Omitted on the tab, where the tab's own label says it. */
  label?: string
  children: ReactNode
}) {
  const row = size === 'row'
  return (
    <span
      // Labelled or hidden, never in between: a bare `aria-label` on a <span>
      // with no role is not announced (the same trap RowStateIcon documents),
      // and an unlabelled badge is decoration next to a tab that already reads
      // "Unread".
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      title={label}
      className={`shrink-0 inline-flex items-center justify-center font-mono font-semibold leading-none tabular-nums tracking-normal ${
        row ? 'px-1' : 'h-4 min-w-4 px-1 text-2xs'
      } ${BADGE_TONE[tone]}`}
      style={
        row
          ? {
              height: 'var(--sidebar-badge-size)',
              minWidth: 'var(--sidebar-badge-size)',
              fontSize: 'var(--sidebar-badge-font-size)',
            }
          : undefined
      }
    >
      {children}
    </span>
  )
}

// Counts past three figures stop being a count and start being a column width.
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

// The rail's segmented control as a whole — the Archived toggle plus the type
// tabs — and the single moving bar that marks which one is live.
//
// ONE BAR, NOT A BORDER PER TAB. Every tab used to draw its own bottom rule, so
// the selection teleported: the mark disappeared in one place and reappeared in
// another, which reads as two marks rather than one selection moving. A shared
// bar travels the distance and takes the eye with it. It is placed with a
// transform and a width, so the motion costs no layout and cannot disturb the
// tabs it runs under.
//
// The position is MEASURED off whichever child reports `aria-pressed="true"`
// rather than passed down: the buttons already declare their state for
// assistive tech, and reading the same source means the bar can never disagree
// with what a screen reader is told. Measuring also means the bar survives the
// row wrapping at the narrowest rail width — it tracks y as well as x.
export function FilterTabBar({
  activeKey,
  children,
}: {
  /** Changes whenever the selection does; re-measures the bar. */
  activeKey: string
  children: ReactNode
}) {
  // The measuring/sliding mechanism is shared with the Group Info tabs, the
  // Settings segmented control and the conversation bar — see
  // components/useTravellingMarker.
  const { trackRef, rect } = useTravellingMarker(activeKey, '[aria-pressed="true"]')

  return (
    <div ref={trackRef} className="relative px-3 flex items-center gap-4 shrink-0">
      <div className="flex min-w-0 flex-wrap items-center gap-4">{children}</div>
      {rect && (
        <span
          aria-hidden
          // Mounted only once a position is known, which is also what keeps the
          // first placement still: a transition has no previous value to run
          // from on the frame an element is inserted, so the bar appears under
          // the live tab and only travels on later changes.
          className="travelling-marker pointer-events-none absolute left-0 top-0 h-0.5 bg-text motion-reduce:transition-none"
          style={{
            width: rect.w,
            // One pixel above the item's bottom edge, so the 2px bar covers the
            // tab's own (permanently transparent) hairline. The row used to
            // carry a `border-b` for the bar to sit on; the rule is gone (user,
            // 2026-08-21), so the bar is now the only mark on the row and simply
            // underlines the live tab. The -1 keeps it inside the row's box
            // rather than hanging a pixel below it.
            transform: `translate(${rect.x}px, ${rect.y + rect.h - 1}px)`,
          }}
        />
      )}
    </div>
  )
}

// One item in the rail's segmented control (All / Groups / Direct / Unread).
//
// A mono uppercase TEXT tab, not a pill: filters are chrome, and chrome speaks
// mono in this UI. The active option is marked by full-brightness text under
// the shared travelling bar rather than by a fill — a filled pill would be the
// only solid shape in a rail made entirely of rules. Sized off the shared
// eyebrow recipe. The Archived STATE lives on its own toggle (ArchiveToggle) —
// never mixed in, though it shares the bar, since exactly one of the five is
// live at a time.
//
// The transparent `border-b` stays on every tab in every state: it reserves the
// row the bar is drawn into, so switching tabs cannot shift the text by a
// pixel. `.filter-tab-active` rather than `text-text` because `.eyebrow` sets
// this label's colour and wins a tie on specificity.
export function FilterTab({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  /** Live count shown after the label (Unread). Omitted when zero. */
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`eyebrow inline-flex items-center gap-1.5 border-b border-transparent py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'filter-tab-active' : 'hover:text-text'
      }`}
    >
      {children}
      {badge !== undefined && (
        <UnreadBadge size="tab" tone={active ? 'count' : 'quiet'}>
          {unreadLabel(badge)}
        </UnreadBadge>
      )}
    </button>
  )
}

// The Archived-state toggle — a quiet icon button leading the type tabs. Its
// icon-only treatment keeps this state axis distinct from the labelled tabs.
export function ArchiveToggle({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      // `self-stretch`, not a fixed height: it shares the travelling bar with
      // the tabs beside it, so its bottom edge has to BE their bottom edge. At
      // h-6 it sat two pixels shy of them and the bar jogged upward on its way
      // in.
      className={`w-6 self-stretch flex items-center justify-center border-b border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'text-text' : 'text-faint hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// A rail row's second line: the conversation's operational facts, set in the
// mono voice and split by a vertical hairline — `SV 14 HLS │ RO→IT`.
//
// This is what replaced the avatar. Type used to be encoded by the identity
// slot's SHAPE (circle = person, squircle = vehicle room); now it's encoded by
// what the row can actually say about itself, which is more useful to scan and
// costs no horizontal space. Empty segments are dropped, so a row with one fact
// simply shows one.
export function RowMeta({ segments }: { segments: (string | null | undefined)[] }) {
  const parts = segments.filter((p): p is string => Boolean(p && p.trim()))
  if (parts.length === 0) return null
  return (
    <span className="eyebrow flex min-w-0 items-center leading-tight">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="mx-2 h-3 w-px shrink-0 bg-line" />}
          <span className="min-w-0 truncate">{part}</span>
        </Fragment>
      ))}
    </span>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-faint px-3 py-1 leading-[1.45]"
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
    >
      {children}
    </div>
  )
}

// One rail menu row (user menu + the create/options menu) — the shared action-
// menu recipe from menuStyles, so the sidebar's menus read identically to the
// message and conversation-row menus.
export function MenuItem({
  icon,
  onClick,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  // 'danger' renders the row (icon + label) in the alert colour, with a subtle
  // red hover — used for destructive actions like Sign out.
  tone?: 'default' | 'danger'
}) {
  return (
    <button onClick={onClick} role="menuitem" className={menuItemClass(tone)}>
      <span className={menuIconClass(tone)}>{icon}</span>
      {children}
    </button>
  )
}
