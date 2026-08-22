import type { ReactNode } from 'react'
import { Flag, Navigation } from 'lucide-react'
import type { RoutePointRole } from '../../lib/here/types'

// ── The Route planner's itinerary list ──────────────────────────────────────
// Every row of the planner's point list — a committed start / stop /
// destination, an empty slot waiting for a search field, the inline address
// editor, and the "add stop" affordance — is built from the same two pieces:
//
//   RouteRow        the shared gutter: the role badge, plus the connector
//                   hairline that runs down to the NEXT row's badge.
//   RoutePointCard  the surface a committed point sits on inside that row.
//
// The connector is what makes the list read as one itinerary instead of a stack
// of unrelated boxes — a route is a sequence, and every row (including the empty
// slots and "add stop") hangs off the same spine:
//
//   ⬤   Bulevardul Republicii 12                       ✎  ✕
//   │    Ploiești 100066 · Romania                        ⧉
//   │
//   ②   Depozit Nord                                    ✎  ✕
//   │    Buftea 070000 · Romania                          ⧉
//   │
//   ⚑   Cluj-Napoca                                     ✎  ✕
//
// The role marker is the only colour on a row: green for the start, coral for
// the destination, a plain numbered chip for a stop — legible, never louder than
// the address. Cards carry no resting border: the spine and the badges give the
// list its structure, and a 300px column can't afford six hairline boxes. Every
// `--` state (hover / selected / dragging / invalid / disabled) is expressed on
// the card, drawn with RINGS rather than borders so nothing shifts by a pixel
// between them, and a caller never re-invents one.

export type RoutePointCardState = {
  /** Row is being dragged (the source row, not the drop target). */
  dragging?: boolean
  /** Row is the focused/edited point. */
  selected?: boolean
  /** Address failed validation / the API rejected it. */
  invalid?: boolean
  /** Route is recalculating, or the caller can't act on this row yet. */
  disabled?: boolean
}

// The leading marker. Start and destination read by ICON (they are unique and
// can't be renumbered); stops read by NUMBER, since their order is the point.
export function RoleBadge({
  role,
  index,
  muted = false,
}: {
  role: RoutePointRole | 'add'
  index?: number
  /** Empty slots draw the badge quietly — nothing is set there yet. */
  muted?: boolean
}) {
  const base = 'h-6 w-6 shrink-0 border flex items-center justify-center'
  if (role === 'start') {
    return (
      <span
        aria-hidden
        title="Start"
        className={`${base} ${muted ? 'border-done/20 bg-done/5 text-done/60' : 'border-done/30 bg-done/10 text-done'}`}
      >
        <Navigation size="0.6875rem" strokeWidth={2.2} />
      </span>
    )
  }
  if (role === 'destination') {
    return (
      <span
        aria-hidden
        title="Destination"
        className={`${base} ${muted ? 'border-alert/20 bg-alert/5 text-alert/60' : 'border-alert/30 bg-alert/10 text-alert'}`}
      >
        <Flag size="0.6875rem" strokeWidth={2.2} />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      title={role === 'add' ? 'New stop' : `Stop ${index}`}
      className={`${base} border-line-2 bg-white/6 text-2xs font-semibold tabular-nums ${
        muted ? 'text-faint' : 'text-muted'
      }`}
    >
      {role === 'add' ? '+' : index}
    </span>
  )
}

// ── Row shell ───────────────────────────────────────────────────────────────
// Gutter metrics, in one place because three separate row shapes have to land on
// the same axis: the 24px badge is dropped 6px (`pt-1.5`) so it centres against
// BOTH a card's first text line and a 36px search field, and the connector's
// −10px bottom margin is exactly the list gap (4px) plus that 6px, so the
// hairline stops on the next badge instead of near it.
export function RouteRow({
  badge,
  children,
  rowKey,
  connect = false,
  draggable = false,
  dragging = false,
  dragProps,
}: {
  badge: ReactNode
  /** The row's content: a RoutePointCard, a search field, an add button. */
  children: ReactNode
  /**
   * Stable identity for the reorder animation (see useFlipReorder): rows are
   * matched across a reorder by this key, which is how "the stop slid down one
   * slot" is told apart from "a different stop is rendering here now".
   */
  rowKey?: string
  /** Draw the connector down to the next row. False on the last row only. */
  connect?: boolean
  /** Row can be dragged to reorder — the whole row is the handle. */
  draggable?: boolean
  dragging?: boolean
  /** Native DnD handlers, spread onto the outer row by the planner. */
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
}) {
  return (
    <div
      {...dragProps}
      data-flip-key={rowKey}
      // The hint sits on the row, not on the badge: the badge, the address and
      // every action already carry their own title, and a nested one would never
      // surface. The whole row is the drag surface anyway.
      title={draggable ? 'Drag to reorder' : undefined}
      // The held row is lifted out of the stack (`relative z-10`) so that while
      // the rows slide past each other it crosses OVER the ones it displaces
      // rather than disappearing behind them — the point of animating the
      // reorder is to be able to follow this row.
      className={`group/row flex gap-2.5 transition-opacity motion-reduce:transition-none ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'relative z-10 opacity-60' : ''}`}
    >
      <div className="flex w-6 shrink-0 flex-col items-center pt-1.5">
        {/* The badge doubles as the drag affordance: the whole row is
            draggable, so rather than spending ~17px of a 300px column on a grip
            glyph, the marker itself picks up the grab cursor and a hover ring. */}
        <span
          className={`transition-shadow motion-reduce:transition-none ${
            draggable ? 'group-hover/row:ring-1 group-hover/row:ring-white/16' : ''
          }`}
        >
          {badge}
        </span>
        {connect && <span aria-hidden className="mt-1 -mb-2.5 w-px flex-1 bg-white/8" />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// ── The card a committed point sits on ──────────────────────────────────────
// Two tiers, and the actions beside the FIRST one only — so the meta line runs
// the full width of the card rather than stopping short at the buttons.
export default function RoutePointCard({
  headline,
  meta,
  actions,
  state = {},
}: {
  /** Primary line — the address. Truncated, one line. */
  headline: ReactNode
  /** Second tier — locality / coordinates. Full card width. */
  meta?: ReactNode
  /** Trailing controls (edit / remove), aligned to the headline. */
  actions?: ReactNode
  state?: RoutePointCardState
}) {
  const { dragging, selected, invalid, disabled } = state
  const surface = invalid
    ? 'bg-alert/10 ring-1 ring-alert/30'
    : dragging
      ? 'bg-white/10 ring-1 ring-white/16'
      : selected
        ? 'bg-white/10'
        : 'bg-white/4 group-hover/row:bg-white/6'

  return (
    <div
      className={`rounded-soft px-2.5 py-2 transition-colors motion-reduce:transition-none ${surface} ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{headline}</div>
        {actions && <div className="-mr-1 -mt-0.5 shrink-0 flex items-center gap-0.5">{actions}</div>}
      </div>
      {meta && <div className="mt-0.5">{meta}</div>}
    </div>
  )
}
