import { useState } from 'react'
import { Check, Copy, Flag, GripVertical, Navigation, Pencil, X } from 'lucide-react'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'
import type { LatLng, RoutePoint, RoutePointRole } from '../../lib/here/types'

// ── Compact row for a committed point (start / stop / destination) ──────────
// Every row is draggable (native DnD) once the route has ≥2 points, so the whole
// route — start and finish included — can be reordered. The reorder happens live
// as the dragged row enters another row; roles are re-derived from the resulting
// order by the parent.
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

  const badge =
    role === 'start' ? (
      <span className="h-5 w-5 shrink-0 rounded-full bg-done flex items-center justify-center text-bg">
        <Navigation size="0.6875rem" strokeWidth={2.4} />
      </span>
    ) : role === 'destination' ? (
      <span className="h-5 w-5 shrink-0 rounded-full bg-alert flex items-center justify-center text-bg">
        <Flag size="0.6875rem" strokeWidth={2.4} />
      </span>
    ) : (
      <span className="h-5 w-5 shrink-0 rounded-full border-2 border-active text-[0.625rem] font-bold flex items-center justify-center">
        {index}
      </span>
    )

  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              // Required for Firefox to start a drag; also marks the payload.
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', point.id)
              onDragStartRow?.()
            }
          : undefined
      }
      onDragEnter={draggable ? () => onDragEnterRow?.() : undefined}
      // preventDefault marks this row as a valid drop target so the live reorder
      // (done on dragenter) sticks and the cursor reads as "movable".
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDragEnd={draggable ? () => onDragEndRow?.() : undefined}
      className={`flex items-center gap-2 rounded-card border bg-white/[0.04] px-2.5 py-1.5 transition-[opacity,border-color] ${
        dragging ? 'opacity-50 border-active/40' : 'border-white/[0.06]'
      }`}
    >
      {draggable && (
        <span
          aria-hidden
          title="Drag to reorder"
          className="shrink-0 -ml-0.5 -mr-0.5 text-muted/60 hover:text-text cursor-default"
        >
          <GripVertical size="0.875rem" strokeWidth={1.8} />
        </span>
      )}
      <div className="shrink-0">{badge}</div>
      <div className="min-w-0 flex-1">
        {onEdit ? (
          <button
            onClick={onEdit}
            title="Edit address"
            className="block w-full text-left text-[0.78125rem] leading-tight truncate hover:text-text transition-colors"
          >
            {point.label}
          </button>
        ) : (
          <div className="text-[0.78125rem] leading-tight truncate" title={point.label}>
            {point.label}
          </div>
        )}
        <button
          onClick={copyCoord}
          title="Copy coordinates"
          className="group flex items-center gap-1 text-[0.6875rem] text-muted hover:text-text transition-colors tabular-nums"
        >
          {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
          {copied ? (
            <Check size="0.6875rem" strokeWidth={2.4} className="text-done" />
          ) : (
            <Copy size="0.6875rem" strokeWidth={1.8} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
          {point.source === 'map' && <span className="text-faint">· map</span>}
        </button>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {onEdit && (
          <IconBtn label="Edit address" onClick={onEdit}>
            <Pencil size="0.8125rem" strokeWidth={1.8} />
          </IconBtn>
        )}
        <IconBtn label="Remove" onClick={onClear}>
          <X size="0.875rem" strokeWidth={2} />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
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
