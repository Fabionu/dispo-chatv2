import type { ReactNode } from 'react'
import { Flag, Navigation, Plus } from 'lucide-react'
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
// The role marker is the only colour on a row: a green ring for the start, a
// coral ring for the destination, a plain numbered ring for a stop — legible,
// never louder than the address. A SOLID ring means the point is set, a DASHED
// one means the slot is still open. Rows are UNBOXED (the 2026-10-12 "Ledger"
// pass): no resting fill, no resting border — the spine and the rings give the
// list its structure, and a 300px column can't afford six boxes inside a box.
// The ROW carries the states (hover wash, dragging, invalid), drawn with RINGS
// rather than borders so nothing shifts by a pixel between them, and the edit /
// remove actions only show while the row is hovered or focused.

export type RoutePointCardState = {
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
  // ROUND, tracking the map marks (see here/hereMapIcons). This badge and the
  // pin are deliberately the same object drawn twice — the panel is the map's
  // legend — so the shape has to move with them; leaving these square when the
  // pins went round on 2026-09-03 would break the only thing tying the list to
  // the map. It is a deliberate exception to "rounded-full means content, not
  // chrome" (see the radius scale in tailwind.config.js).
  // 20px (was 24) since the rows went compact on 2026-09-11 — the badge has
  // to sit on the centre of a 28px field and of a card's first text line, and
  // 24 outweighed both. A RING since 2026-10-12 (it was a tinted disc):
  // thinner, and it frees the dashed variant to mean "this slot is still open".
  const base = 'h-5 w-5 shrink-0 rounded-full border-[1.5px] flex items-center justify-center'
  const open = 'border-dashed border-line-2 text-faint'
  if (role === 'start') {
    return (
      <span aria-hidden title="Start" className={`${base} ${muted ? open : 'border-done text-done'}`}>
        <Navigation size="0.625rem" strokeWidth={2.4} />
      </span>
    )
  }
  if (role === 'destination') {
    return (
      <span aria-hidden title="Destination" className={`${base} ${muted ? open : 'border-alert text-alert'}`}>
        <Flag size="0.625rem" strokeWidth={2.4} />
      </span>
    )
  }
  if (role === 'add') {
    return (
      <span aria-hidden title="New stop" className={`${base} ${open}`}>
        <Plus size="0.625rem" strokeWidth={2.4} />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      title={`Stop ${index}`}
      className={`${base} border-line-2 text-2xs font-semibold tabular-nums ${
        muted ? 'text-faint' : 'text-muted'
      }`}
    >
      {index}
    </span>
  )
}

// ── Row shell ───────────────────────────────────────────────────────────────
// Gutter metrics, in one place because three separate row shapes have to land on
// the same axis. Everything hangs off ONE number: the first line of every row
// has its centre 14px below the row's top — a 28px search field / add-stop
// button (h-7), and a card with 6px of padding over a 16px headline
// (`py-1.5` + `leading-[1.25]` at 13px). So the 20px badge is dropped 4px
// (`pt-1`) to put its own centre there, and the connector's −6px bottom margin
// is exactly the list gap (2px) plus that 4px, so the hairline stops on the
// next badge instead of near it. Change one of these and change them all.
export function RouteRow({
  badge,
  children,
  rowKey,
  connect = false,
  draggable = false,
  dragging = false,
  invalid = false,
  hoverable = false,
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
  /** The point has no usable coordinates — the whole row, badge included, says so. */
  invalid?: boolean
  /** A committed point: the row washes on hover. Search slots and the inline editor don't. */
  hoverable?: boolean
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
      // reorder is to be able to follow this row. The wash lives on the ROW
      // (not on the card inside it) so the badge sits on it too: the row is one
      // object. Rings, not borders, for dragging / invalid, so no state moves
      // the text by a pixel.
      className={`group/row flex gap-2.5 rounded-btn px-1.5 transition-[background-color,opacity] motion-reduce:transition-none ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        invalid
          ? 'bg-alert/10 ring-1 ring-alert/30'
          : dragging
            ? 'relative z-10 bg-white/10 opacity-60 ring-1 ring-white/16'
            : hoverable
              ? 'hover:bg-white/4'
              : ''
      }`}
    >
      <div className="flex w-5 shrink-0 flex-col items-center pt-1">
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
        {connect && <span aria-hidden className="mt-1 -mb-1.5 w-px flex-1 bg-line-2" />}
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
  const { disabled } = state

  return (
    <div className={`py-1.5 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {/* The 20px action buttons overhang the 16px headline by 2px each way
          (`-my-0.5`) rather than stretching the line to fit them — that is
          what keeps the card at 42px instead of 46. They only show while the
          row is hovered or something inside it has focus, so a resting list is
          just addresses. */}
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{headline}</div>
        {actions && (
          <div className="-mr-1 -my-0.5 shrink-0 flex items-center gap-0.5 opacity-0 transition-opacity motion-reduce:transition-none group-hover/row:opacity-100 focus-within:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {meta && <div className="mt-px">{meta}</div>}
    </div>
  )
}
