import EditableRow from '../EditableRow'
import AssignedDrivers from './AssignedDrivers'
import { SelectRow, SubHeading } from './opsControls'
import { VEHICLE_STATUSES, type TruckProfile, type VehicleInfo } from '../../lib/vehicleOps'
import { tractorPlate, trailerPlate, type Group, type GroupMember } from '../../lib/types'

type Props = {
  group: Group
  canManage: boolean
  vehicle: VehicleInfo
  // The room's members — the pool the assigned-drivers picker chooses from.
  members: GroupMember[]
  // Currently-assigned driver user ids (structured assignment; lives on the trip).
  assignedDriverIds: string[]
  // Persist a group-level detail (name / plates / description) — reuses the
  // existing PATCH path, so plate editing behaves exactly as before.
  onSaveField: (
    patch: Partial<{ name: string; description: string | null; tractorPlate: string | null; trailerPlate: string | null }>,
  ) => Promise<void>
  // Persist a patch onto the vehicle ops sub-object.
  onSaveVehicle: (patch: Partial<VehicleInfo>) => Promise<void>
  // Persist the structured assigned-driver ids (creates a trip to hold them when
  // none exists yet). Membership is re-validated server-side.
  onSaveDrivers: (ids: string[]) => Promise<void>
}

// Vehicle Info tab: the permanent vehicle's identity + manual status. Group-level
// fields (name, plates, description) keep using the existing per-field PATCH;
// the richer vehicle fields live in the ops blob. Each field edits individually,
// matching the rest of the panel.
// The truck-profile fields, in storage order. `unit` is shown in the label so a
// dispatcher enters exact restriction values (HERE units: centimetres/kilograms);
// axle/trailer counts are plain integers.
const TRUCK_FIELDS: ReadonlyArray<{
  key: keyof TruckProfile
  label: string
  placeholder: string
}> = [
  { key: 'heightCm', label: 'Height (cm)', placeholder: 'e.g. 400' },
  { key: 'widthCm', label: 'Width (cm)', placeholder: 'e.g. 255' },
  { key: 'lengthCm', label: 'Length (cm)', placeholder: 'e.g. 1650' },
  { key: 'grossWeightKg', label: 'Gross weight (kg)', placeholder: 'e.g. 40000' },
  { key: 'axleCount', label: 'Axles', placeholder: 'e.g. 5' },
  { key: 'trailerCount', label: 'Trailers', placeholder: 'e.g. 1' },
]

export default function VehicleInfoTab({
  group,
  canManage,
  vehicle,
  members,
  assignedDriverIds,
  onSaveField,
  onSaveVehicle,
  onSaveDrivers,
}: Props) {
  const truck = vehicle.truckProfile ?? {}

  // Persist one truck-profile number. Empty / non-positive input clears the
  // field; the whole profile is dropped once it holds no numbers (so an empty
  // profile is `undefined`, not `{}`). The server re-validates the ranges.
  function saveTruckField(key: keyof TruckProfile, raw: string): Promise<void> {
    const n = Number.parseInt(raw, 10)
    const next: TruckProfile = { ...truck }
    if (!raw.trim() || Number.isNaN(n) || n <= 0) delete next[key]
    else next[key] = n
    const hasAny = Object.values(next).some((v) => typeof v === 'number')
    return onSaveVehicle({ truckProfile: hasAny ? next : undefined })
  }

  return (
    <div>
      <SubHeading>Identity</SubHeading>
      <EditableRow
        label="Room name"
        value={group.name}
        editable={canManage}
        required
        onSave={(v) => onSaveField({ name: v })}
      />
      <EditableRow
        label="Tractor plate"
        value={tractorPlate(group)}
        editable={canManage}
        placeholder="e.g. B-123-ABC"
        onSave={(v) => onSaveField({ tractorPlate: v || null })}
      />
      <EditableRow
        label="Trailer plate"
        value={trailerPlate(group)}
        editable={canManage}
        placeholder="e.g. B-456-XYZ"
        onSave={(v) => onSaveField({ trailerPlate: v || null })}
      />
      <EditableRow
        label="Vehicle type"
        value={vehicle.vehicleType}
        editable={canManage}
        placeholder="e.g. Tractor unit, Van"
        onSave={(v) => onSaveVehicle({ vehicleType: v || undefined })}
      />
      <EditableRow
        label="Trailer type"
        value={vehicle.trailerType}
        editable={canManage}
        placeholder="e.g. Curtainsider, Reefer"
        onSave={(v) => onSaveVehicle({ trailerType: v || undefined })}
      />
      <EditableRow
        label="Description"
        value={group.description}
        editable={canManage}
        multiline
        placeholder="Optional description of this vehicle room"
        onSave={(v) => onSaveField({ description: v || null })}
      />

      <SubHeading>Status &amp; crew</SubHeading>
      <SelectRow
        label="Current status"
        value={vehicle.status}
        options={VEHICLE_STATUSES}
        editable={canManage}
        onSave={(v) => onSaveVehicle({ status: v })}
      />
      {/* Assigned drivers — a structured member picker (room members only), so
          the mobile driver API can resolve "trips assigned to me" and a change
          logs an activity row. This marks who DRIVES this room operationally; it
          does not change anyone's company role. */}
      <AssignedDrivers
        members={members}
        assignedIds={assignedDriverIds}
        canManage={canManage}
        onSave={onSaveDrivers}
      />

      {/* Truck profile — dimensions/weight the route calc + a future mobile truck
          navigation use. Belongs to the vehicle (one truck per room), entered once
          and reused by every trip. */}
      <SubHeading>Truck profile</SubHeading>
      {TRUCK_FIELDS.map((f) => (
        <EditableRow
          key={f.key}
          label={f.label}
          value={truck[f.key] !== undefined ? String(truck[f.key]) : undefined}
          editable={canManage}
          placeholder={f.placeholder}
          onSave={(v) => saveTruckField(f.key, v)}
        />
      ))}

      <SubHeading>Notes</SubHeading>
      <EditableRow
        label="Internal vehicle notes"
        value={vehicle.notes}
        editable={canManage}
        multiline
        placeholder="Notes about this vehicle (internal)"
        onSave={(v) => onSaveVehicle({ notes: v || undefined })}
      />
    </div>
  )
}
