import { useState, type FormEvent } from 'react'
import { EditableField, EditableTextarea } from '../forms'
import { SettingsSection } from '../settings/sectionChrome'
import type { TruckProfile, VehicleInfo } from '../../lib/vehicleOps'
import { tractorPlate, trailerPlate, type Group } from '../../lib/types'

type Props = {
  group: Group
  canManage: boolean
  vehicle: VehicleInfo
  // Persist a group-level detail (name / plates / description) — reuses the
  // existing PATCH path, so plate editing behaves exactly as before.
  onSaveField: (
    patch: Partial<{ name: string; description: string | null; tractorPlate: string | null; trailerPlate: string | null }>,
  ) => Promise<void>
  // Persist a patch onto the vehicle ops sub-object.
  onSaveVehicle: (patch: Partial<VehicleInfo>) => Promise<void>
}

// The truck-profile values, in storage order. Stored in HERE's units
// (centimetres / kilograms); shown in metres and tonnes, which is how a
// dispatcher reads a truck, and entered back in the stored unit so a value is
// never rounded on its way in.
const TRUCK_FIELDS: ReadonlyArray<{
  key: keyof TruckProfile
  label: string
  unit: string
  format: (v: number) => string
}> = [
  { key: 'heightCm', label: 'Height', unit: 'cm', format: (v) => `${(v / 100).toFixed(2)} m` },
  { key: 'widthCm', label: 'Width', unit: 'cm', format: (v) => `${(v / 100).toFixed(2)} m` },
  { key: 'lengthCm', label: 'Length', unit: 'cm', format: (v) => `${(v / 100).toFixed(2)} m` },
  { key: 'grossWeightKg', label: 'Gross weight', unit: 'kg', format: (v) => `${+(v / 1000).toFixed(1)} t` },
  { key: 'axleCount', label: 'Axles', unit: '', format: (v) => String(v) },
  { key: 'trailerCount', label: 'Trailers', unit: '', format: (v) => String(v) },
]

// Group info → Vehicle: the permanent truck. Reworked 2026-10-12 from the
// "Profile & group info rework" canvas: the status and the driver assignment
// moved out (status above the tabs, drivers to Crew), the identity fields are a
// label-column card where the row is the edit target, and the truck profile is
// six readable tiles edited together instead of six "Height (cm)" rows.
export default function VehicleInfoTab({ group, canManage, vehicle, onSaveField, onSaveVehicle }: Props) {
  return (
    <div className="flex flex-col">
      <SettingsSection title="Vehicle">
        <div className="overflow-hidden rounded-card border border-line divide-y divide-line">
          <EditableField
            variant="columns"
            label="Room name"
            value={group.name}
            editable={canManage}
            required
            onSave={(v) => onSaveField({ name: v })}
          />
          <EditableField
            variant="columns"
            label="Tractor plate"
            value={tractorPlate(group)}
            editable={canManage}
            placeholder="e.g. B-123-ABC"
            onSave={(v) => onSaveField({ tractorPlate: v || null })}
          />
          <EditableField
            variant="columns"
            label="Trailer plate"
            value={trailerPlate(group)}
            editable={canManage}
            placeholder="e.g. B-456-XYZ"
            onSave={(v) => onSaveField({ trailerPlate: v || null })}
          />
          <EditableField
            variant="columns"
            label="Vehicle type"
            value={vehicle.vehicleType}
            editable={canManage}
            placeholder="e.g. Tractor unit, Van"
            onSave={(v) => onSaveVehicle({ vehicleType: v || undefined })}
          />
          <EditableField
            variant="columns"
            label="Trailer type"
            value={vehicle.trailerType}
            editable={canManage}
            placeholder="e.g. Curtainsider, Reefer"
            onSave={(v) => onSaveVehicle({ trailerType: v || undefined })}
          />
        </div>
      </SettingsSection>

      <TruckProfileSection
        truck={vehicle.truckProfile ?? {}}
        canManage={canManage}
        onSave={(truckProfile) => onSaveVehicle({ truckProfile })}
      />

      <SettingsSection title="Notes" last>
        <div className="overflow-hidden rounded-card border border-line divide-y divide-line">
          <EditableTextarea
            variant="card"
            label="Description"
            value={group.description}
            editable={canManage}
            placeholder="What this vehicle room is for"
            onSave={(v) => onSaveField({ description: v || null })}
          />
          <EditableTextarea
            variant="card"
            label="Internal notes"
            value={vehicle.notes}
            editable={canManage}
            placeholder="What the next dispatcher should know about this truck"
            onSave={(v) => onSaveVehicle({ notes: v || undefined })}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

// The six dimensions the route calculation uses, as tiles; Edit turns all six
// into inputs at once (they are entered together, from one registration
// document) with one Save.
function TruckProfileSection({
  truck,
  canManage,
  onSave,
}: {
  truck: TruckProfile
  canManage: boolean
  onSave: (next: TruckProfile | undefined) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    const next: Record<string, string> = {}
    for (const f of TRUCK_FIELDS) next[f.key] = truck[f.key] !== undefined ? String(truck[f.key]) : ''
    setDrafts(next)
    setError(null)
    setEditing(true)
  }

  // Empty or non-positive clears a value; the profile is dropped entirely once
  // it holds no numbers (undefined, not {}). The server re-validates ranges.
  async function save(e: FormEvent) {
    e.preventDefault()
    const next: TruckProfile = {}
    for (const f of TRUCK_FIELDS) {
      const raw = (drafts[f.key] ?? '').trim()
      if (!raw) continue
      const n = Number.parseInt(raw, 10)
      if (Number.isNaN(n) || n <= 0) {
        setError(`${f.label} must be a whole number above zero.`)
        return
      }
      next[f.key] = n
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(Object.keys(next).length ? next : undefined)
      setEditing(false)
    } catch {
      setError('Could not save the truck profile. Check the values and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection
      title="Truck profile"
      description="Routes for this truck avoid low bridges, weight limits and tunnels it can’t use."
      action={
        canManage && !editing ? (
          <button
            type="button"
            onClick={start}
            className="h-8 rounded-btn border border-line-2 px-3 text-base font-semibold transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            Edit
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-3 gap-2">
            {TRUCK_FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex cursor-text flex-col gap-1 rounded-card border border-line-2 px-2.5 py-2 focus-within:border-text/60"
              >
                <span className="text-sm text-muted">{f.label}</span>
                <span className="flex items-baseline gap-1">
                  <input
                    value={drafts[f.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                    inputMode="numeric"
                    placeholder="–"
                    disabled={saving}
                    className="w-full min-w-0 bg-transparent p-0 text-xl font-semibold tabular-nums text-text outline-none placeholder:text-faint"
                  />
                  {f.unit && <span className="shrink-0 text-sm text-faint">{f.unit}</span>}
                </span>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="h-7 rounded-btn border border-line-2 px-2.5 text-sm font-semibold transition-colors hover:bg-white/6 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-7 rounded-btn bg-text px-3 text-sm font-semibold text-bg transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {TRUCK_FIELDS.map((f) => {
            const v = truck[f.key]
            return (
              <div key={f.key} className="flex min-w-0 flex-col gap-0.5 rounded-card border border-line px-3 py-2.5">
                <span
                  className={`truncate text-xl font-semibold tracking-[-0.01em] tabular-nums ${
                    v !== undefined ? 'text-text' : 'text-faint'
                  }`}
                >
                  {v !== undefined ? f.format(v) : 'Not set'}
                </span>
                <span className="truncate text-sm text-muted">{f.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}
