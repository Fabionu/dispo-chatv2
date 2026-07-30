import type { ReactNode } from 'react'
import { Flag, GripVertical, Navigation } from 'lucide-react'
import type { RoutePointRole } from '../../lib/here/types'

// ── The Route planner's card ────────────────────────────────────────────────
// ONE card behind every point in the planner: a committed start / stop /
// destination, an empty slot waiting for a search field, and the "add stop"
// affordance. Before this each of those was assembled inline with its own
// badge markup and spacing, so a filled row and an empty row didn't line up.
//
// Anatomy (the planner column is only 300px wide, so every part earns its
// space):
//
//   [role]  primary line — the address, truncated, one line
//           meta line    — coordinates / postcode / source, quieter
//                                                          [actions]
//
// The role marker is the only colour on the card: green for the start, coral
// for the destination, and a plain numbered chip for a stop — the number is
// legible but never louder than the address. `--` states are expressed on the
// card itself (hover / selected / dragging / error / disabled) so a caller
// never re-invents them.

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
  const base = 'h-6 w-6 shrink-0 rounded-full border flex items-center justify-center'
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
      className={`${base} border-white/16 bg-white/6 text-2xs font-semibold tabular-nums ${
        muted ? 'text-faint' : 'text-muted'
      }`}
    >
      {role === 'add' ? '+' : index}
    </span>
  )
}

// The card shell: badge gutter + body + trailing actions, with the shared
// surface/border/radius tokens and every interaction state in one place.
export default function RoutePointCard({
  badge,
  children,
  actions,
  handle,
  state = {},
  dragProps,
}: {
  badge: ReactNode
  children: ReactNode
  /** Trailing controls (edit / remove). Vertically centred, never wrapping. */
  actions?: ReactNode
  /** Drag handle — rendered ONLY when the caller passes one, so a row that
   *  can't be reordered shows no affordance for it. */
  handle?: boolean
  state?: RoutePointCardState
  /** Native DnD handlers, spread onto the outer row by the planner. */
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
}) {
  const { dragging, selected, invalid, disabled } = state
  const edge = invalid
    ? 'border-alert/50 bg-alert/[0.06]'
    : dragging
      ? 'border-white/20 bg-white/8'
      : selected
        ? 'border-white/16 bg-white/6'
        : 'border-white/6 bg-white/4 hover:border-white/12 hover:bg-white/6'

  return (
    <div
      {...dragProps}
      className={`flex items-start gap-2 transition-opacity motion-reduce:transition-none ${
        dragging ? 'opacity-60' : ''
      } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="pt-1.5">{badge}</div>
      <div
        className={`min-w-0 flex-1 flex items-start gap-1 rounded-card border px-1.5 py-1.5 transition-colors motion-reduce:transition-none ${edge}`}
      >
        {handle && (
          <span
            aria-hidden
            title="Drag to reorder"
            className="shrink-0 self-center text-faint hover:text-muted cursor-grab active:cursor-grabbing"
          >
            <GripVertical size="0.8125rem" strokeWidth={1.8} />
          </span>
        )}
        <div className="min-w-0 flex-1">{children}</div>
        {actions && <div className="shrink-0 flex items-center gap-0.5 self-center">{actions}</div>}
      </div>
    </div>
  )
}
