import { Pencil, Trash2 } from 'lucide-react'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'
import { STOP_TYPES, labelOf, stopLocationLabel, type VehicleStop } from '../../lib/vehicleOps'

// Compact read-only stop row in the Add-trip list, with edit + remove actions.
// A deliberately simpler single-line variant than the shared trip-tab StopCard
// (no status chip / structured lines) — it lists stops the dispatcher is still
// assembling before the trip is created.
export default function AddTripStopCard({
  stop,
  onEdit,
  onRemove,
}: {
  stop: VehicleStop
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-card bg-white/[0.03] px-2.5 py-2">
      <span className="text-[0.75rem] font-medium shrink-0">{labelOf(STOP_TYPES, stop.type)}</span>
      <span className="flex-1 min-w-0 truncate text-[0.75rem] text-muted">
        {[stopLocationLabel(stop), stop.plannedAt].filter(Boolean).join(' · ') || '—'}
      </span>
      <button
        onClick={onEdit}
        aria-label="Edit stop"
        title="Edit stop"
        className={`${ICON_ACTION_SMALL} shrink-0 transition-colors`}
      >
        <Pencil size="0.8125rem" strokeWidth={1.8} />
      </button>
      <button
        onClick={onRemove}
        aria-label="Remove stop"
        title="Remove stop"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-faint hover:text-alert hover:bg-white/[0.04] transition-colors"
      >
        <Trash2 size="0.8125rem" strokeWidth={1.8} />
      </button>
    </div>
  )
}
