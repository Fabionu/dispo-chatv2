import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Spinner from '../Spinner'
import { StatusDot } from './opsControls'
import { labelOf, vehicleStatusTone, VEHICLE_STATUSES, type VehicleStatus } from '../../lib/vehicleOps'

// The statuses grouped by where the truck is — eight flat options read as a
// wall; three short groups are scanned in one look. Every VEHICLE_STATUSES
// value appears exactly once.
const GROUPS: ReadonlyArray<{ title: string; values: readonly VehicleStatus[] }> = [
  { title: 'On the road', values: ['driving', 'waiting', 'break'] },
  { title: 'At a stop', values: ['loading', 'unloading'] },
  { title: 'Between trips', values: ['available', 'completed', 'service'] },
]

// Group info's vehicle status: one field that says the current status (its
// tone dot + label) and opens a grouped list. Replaced a three-column grid of
// all eight statuses (canvas comment: the grid was not the wanted way to show
// the list). Read-only for non-managers — the same field without the chevron.
export default function VehicleStatusSelect({
  value,
  editable,
  onSave,
}: {
  value: VehicleStatus | undefined
  editable: boolean
  onSave: (status: VehicleStatus) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    // Capture + stop, so Esc closes the list without also closing the panel
    // (GroupInfoPanel listens for Esc on the document).
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  async function pick(next: VehicleStatus) {
    setOpen(false)
    if (next === value) return
    setSaving(true)
    setError(false)
    try {
      await onSave(next)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const label = value ? labelOf(VEHICLE_STATUSES, value) : 'Not set'
  const face = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight text-muted">Vehicle status</span>
        <span className="mt-1 flex items-center gap-2 text-lg font-semibold leading-tight">
          <StatusDot tone={vehicleStatusTone(value)} />
          <span className={value ? 'text-text' : 'text-faint'}>{label}</span>
        </span>
      </span>
      {saving ? (
        <Spinner size={14} />
      ) : (
        editable && (
          <ChevronDown
            size="1rem"
            strokeWidth={1.9}
            aria-hidden
            className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        )
      )}
    </>
  )

  return (
    <div ref={rootRef} className="relative">
      {editable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex w-full items-center gap-3 rounded-card border py-2.5 pl-3.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            open ? 'border-text/70' : 'border-line hover:border-line-2'
          }`}
        >
          {face}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 rounded-card border border-line py-2.5 pl-3.5 pr-3">{face}</div>
      )}

      {error && <p className="mt-1.5 text-sm text-alert">Could not change the status. Try again.</p>}

      {open && (
        <div
          role="listbox"
          aria-label="Vehicle status"
          className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-30 rounded-card border border-line bg-surface px-1 shadow-overlay"
        >
          {GROUPS.map((g, gi) => (
            <div
              key={g.title}
              role="group"
              aria-label={g.title}
              className={`flex flex-col py-1 ${gi > 0 ? 'border-t border-line' : ''}`}
            >
              <span className="px-2.5 pb-1 pt-1.5 text-sm text-faint">{g.title}</span>
              {g.values.map((v) => {
                const on = v === value
                return (
                  <button
                    key={v}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => void pick(v)}
                    className={`flex h-9 items-center gap-2.5 rounded-btn px-2.5 text-left text-lg transition-colors hover:bg-white/6 ${
                      on ? 'bg-white/8' : ''
                    }`}
                  >
                    <StatusDot tone={vehicleStatusTone(v)} />
                    <span className="flex-1">{labelOf(VEHICLE_STATUSES, v)}</span>
                    {on && <Check size="0.875rem" strokeWidth={2.2} className="shrink-0" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
