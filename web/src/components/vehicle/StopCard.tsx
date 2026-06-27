import { Pencil, Trash2 } from 'lucide-react'
import { StatusChip } from './opsControls'
import {
  STOP_STATUSES,
  STOP_TYPES,
  labelOf,
  stopCityLine,
  stopStatusTone,
  type VehicleStop,
} from '../../lib/vehicleOps'

// One compact, read-only stop card: type + status chip on top, then the
// structured address lines, coordinates, planned time and notes, with manage
// actions revealed on hover. Shared by the Trip tab's Stops section (and any
// other place a stop needs to render) so the card style lives in ONE place.
export default function StopCard({
  stop,
  canManage,
  onEdit,
  onRemove,
}: {
  stop: VehicleStop
  canManage: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  // Structured address lines, falling back to the legacy single-line `location`
  // for stops created before the structured fields existed.
  const lines = [stop.company, stop.street, stopCityLine(stop)]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
  if (lines.length === 0 && stop.location?.trim()) lines.push(stop.location.trim())

  return (
    <div className="group rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium">{labelOf(STOP_TYPES, stop.type)}</span>
        <StatusChip tone={stopStatusTone(stop.status)} label={labelOf(STOP_STATUSES, stop.status)} />
        <div className="flex-1" />
        {canManage && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={onEdit}
              aria-label="Edit stop"
              title="Edit stop"
              className="h-6 w-6 flex items-center justify-center rounded-chip text-faint hover:text-text hover:bg-white/[0.04] transition-colors"
            >
              <Pencil size={12} strokeWidth={1.8} />
            </button>
            <button
              onClick={onRemove}
              aria-label="Remove stop"
              title="Remove stop"
              className="h-6 w-6 flex items-center justify-center rounded-chip text-faint hover:text-alert hover:bg-white/[0.04] transition-colors"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {lines.map((l, i) => (
            <div key={i} className="text-[12px] text-text break-words">
              {l}
            </div>
          ))}
        </div>
      )}
      {stop.coordinates && (
        <div className="text-[11px] text-muted mt-0.5 break-words">{stop.coordinates}</div>
      )}
      {stop.plannedAt && <div className="text-[11px] text-muted mt-0.5">{stop.plannedAt}</div>}
      {stop.notes && <div className="text-[11px] text-faint mt-0.5 break-words">{stop.notes}</div>}
    </div>
  )
}
