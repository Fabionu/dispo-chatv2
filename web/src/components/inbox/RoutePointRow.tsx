import { useEffect, useRef, useState } from 'react'
import { Check, Copy, MapPin, Pencil, X } from 'lucide-react'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'
import RoutePointCard, { RoleBadge, RouteRow } from './RoutePointCard'
import { isValidCoord, splitLabel } from './routePlannerUtils'
import type { LatLng, RoutePoint, RoutePointRole } from '../../lib/here/types'

// ── A committed point (start / stop / destination) ──────────────────────────
// A RoutePointCard hung off the shared RouteRow spine, so a filled row, an empty
// slot and the add-stop affordance all sit on the same axis and share the
// connector that ties the list into one itinerary.
//
// Two tiers, chosen for a 300px column:
//   1. the address    — the street/place the point is identified BY
//   2. the locality   — the town/postcode/country that says WHERE it is, or the
//                       coordinates when the point never got a real address
// Showing the whole HERE label on one line truncated it to the street and hid
// the town; split, the same space answers both questions. The coordinates stay
// one click away on every row (the copy glyph at the right of the meta line,
// revealed on hover) instead of occupying the second tier on every row.
//
// Actions (edit, remove) sit beside the FIRST line only, so the meta line runs
// the card's full width. Every row is draggable (native DnD) once the route has
// ≥2 points, so the whole route — start and finish included — can be reordered;
// the badge picks up the grab cursor and hover ring rather than spending column
// width on a grip glyph. The reorder happens live as the dragged row enters
// another row; roles are re-derived from the resulting order by the parent.
export default function PointRow({
  role,
  index,
  point,
  coord,
  connect,
  onClear,
  onEdit,
  draggable = false,
  dragging = false,
  onDragStartRow,
  onDragEnterRow,
  onDragEndRow,
}: {
  role: RoutePointRole
  index?: number
  point: RoutePoint
  coord: LatLng
  /** Draw the spine down to the next row. */
  connect?: boolean
  onClear: () => void
  onEdit?: () => void
  draggable?: boolean
  dragging?: boolean
  onDragStartRow?: () => void
  onDragEnterRow?: () => void
  onDragEndRow?: () => void
}) {
  const { head, rest } = splitLabel(point.label)
  // A point that never resolved to real coordinates is dropped from the routing
  // request, so the card says so rather than looking like a routed stop.
  const invalid = !isValidCoord(coord)

  return (
    <RouteRow
      badge={<RoleBadge role={role} index={index} />}
      connect={connect}
      draggable={draggable}
      dragging={dragging}
      dragProps={
        draggable
          ? {
              draggable: true,
              onDragStart: (e) => {
                // Required for Firefox to start a drag; also marks the payload.
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', point.id)
                onDragStartRow?.()
              },
              onDragEnter: () => onDragEnterRow?.(),
              // preventDefault marks this row as a valid drop target so the live
              // reorder (done on dragenter) sticks and the cursor reads as
              // "movable".
              onDragOver: (e) => e.preventDefault(),
              onDragEnd: () => onDragEndRow?.(),
            }
          : undefined
      }
    >
      <RoutePointCard
        state={{ dragging, invalid }}
        headline={
          // A long address truncates to one line and carries the full label as a
          // tooltip, so it can never push the card wide or wrap into three lines.
          onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              title={point.label}
              className="block w-full truncate text-left text-base font-medium leading-snug text-text transition-colors hover:text-active focus-visible:underline focus-visible:outline-none"
            >
              {head}
            </button>
          ) : (
            <div className="truncate text-base font-medium leading-snug text-text" title={point.label}>
              {head}
            </div>
          )
        }
        meta={
          <div className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-faint">
            {invalid ? (
              <span className="min-w-0 truncate text-alert">No coordinates — not routed</span>
            ) : rest ? (
              <span className="min-w-0 truncate" title={rest}>
                {rest}
              </span>
            ) : (
              <span className="min-w-0 truncate tabular-nums">
                {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
              </span>
            )}
            {(point.source === 'map' || point.source === 'drag') && (
              <span
                title={point.source === 'drag' ? 'Moved on the map' : 'Placed on the map'}
                className="inline-flex shrink-0 items-center gap-0.5"
              >
                <MapPin size="0.625rem" strokeWidth={1.8} aria-hidden />
                map
              </span>
            )}
            {!invalid && (
              <CopyCoord
                coord={coord}
                // When the locality already fills the line the copy glyph is the
                // secondary affordance and stays out of the way until hover;
                // when the coordinates ARE the line it belongs beside them.
                quiet={Boolean(rest)}
              />
            )}
          </div>
        }
        actions={
          <>
            {onEdit && (
              <IconBtn label="Edit address" onClick={onEdit}>
                <Pencil size="0.8125rem" strokeWidth={1.8} />
              </IconBtn>
            )}
            <IconBtn label="Remove point" onClick={onClear}>
              <X size="0.875rem" strokeWidth={2} />
            </IconBtn>
          </>
        }
      />
    </RouteRow>
  )
}

// Copy the point's (displayed) coordinate. `quiet` parks it at the right edge of
// the meta line, invisible until the row is hovered or the button is focused.
function CopyCoord({ coord, quiet }: { coord: LatLng; quiet: boolean }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard?.writeText(`${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy coordinates"
      title={copied ? 'Copied' : 'Copy coordinates'}
      className={`shrink-0 transition-opacity motion-reduce:transition-none hover:text-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:text-muted ${
        quiet ? 'ml-auto opacity-0 group-hover/row:opacity-100' : ''
      }`}
    >
      {copied ? (
        <Check size="0.625rem" strokeWidth={2.4} className="text-done" />
      ) : (
        <Copy size="0.625rem" strokeWidth={1.8} />
      )}
    </button>
  )
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`${ICON_ACTION_SMALL} transition-colors`}
    >
      {children}
    </button>
  )
}
