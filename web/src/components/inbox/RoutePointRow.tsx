import { useState } from 'react'
import { Check, Copy, MapPin, Pencil, X } from 'lucide-react'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'
import RoutePointCard, { RoleBadge } from './RoutePointCard'
import type { LatLng, RoutePoint, RoutePointRole } from '../../lib/here/types'

// ── A committed point (start / stop / destination) ──────────────────────────
// Built on the shared RoutePointCard, so a filled row, an empty slot and the
// add-stop affordance all sit on the same grid and share every state.
//
// Hierarchy inside the card, top to bottom:
//   1. the address        — primary, one truncated line, full text on hover
//   2. the meta line      — coordinates (click to copy) + how the point was set
// Actions (edit, remove) sit on the right, vertically centred, at one size.
//
// Every row is draggable (native DnD) once the route has ≥2 points, so the whole
// route — start and finish included — can be reordered; the drag handle only
// renders when that is actually available. The reorder happens live as the
// dragged row enters another row; roles are re-derived from the resulting order
// by the parent.
export default function PointRow({
  role,
  index,
  point,
  coord,
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
  onClear: () => void
  onEdit?: () => void
  draggable?: boolean
  dragging?: boolean
  onDragStartRow?: () => void
  onDragEnterRow?: () => void
  onDragEndRow?: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyCoord() {
    const text = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <RoutePointCard
      badge={<RoleBadge role={role} index={index} />}
      handle={draggable}
      state={{ dragging }}
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
    >
      {/* Address — the card's headline. A long address truncates to one line
          (the planner column is 300px) and carries the full text as a tooltip,
          so it can never push the card wide or wrap into three lines. */}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          title={point.label}
          className="block w-full text-left text-sm font-medium leading-snug truncate text-text hover:text-active transition-colors focus-visible:outline-none focus-visible:underline"
        >
          {point.label}
        </button>
      ) : (
        <div className="text-sm font-medium leading-snug truncate text-text" title={point.label}>
          {point.label}
        </div>
      )}

      {/* Meta — quieter than the address and clearly a second tier: the
          coordinates (click to copy) and, when it applies, how this point was
          set. */}
      <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={copyCoord}
          title="Copy coordinates"
          className="group min-w-0 flex items-center gap-1 text-2xs text-faint hover:text-muted transition-colors tabular-nums focus-visible:outline-none focus-visible:text-muted"
        >
          <span className="truncate">
            {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
          </span>
          {copied ? (
            <Check size="0.625rem" strokeWidth={2.4} className="shrink-0 text-done" />
          ) : (
            <Copy
              size="0.625rem"
              strokeWidth={1.8}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
            />
          )}
        </button>
        {point.source === 'map' && (
          <span
            title="Placed on the map"
            className="shrink-0 inline-flex items-center gap-0.5 text-2xs text-faint"
          >
            <MapPin size="0.625rem" strokeWidth={1.8} aria-hidden />
            map
          </span>
        )}
      </div>
    </RoutePointCard>
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
