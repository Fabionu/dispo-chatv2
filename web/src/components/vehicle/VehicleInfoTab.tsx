import EditableRow from '../EditableRow'
import { SelectRow, SubHeading } from './opsControls'
import { VEHICLE_STATUSES, type VehicleInfo } from '../../lib/vehicleOps'
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

// Vehicle Info tab: the permanent vehicle's identity + manual status. Group-level
// fields (name, plates, description) keep using the existing per-field PATCH;
// the richer vehicle fields live in the ops blob. Each field edits individually,
// matching the rest of the panel.
export default function VehicleInfoTab({ group, canManage, vehicle, onSaveField, onSaveVehicle }: Props) {
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
      <EditableRow
        label="Assigned driver(s)"
        value={vehicle.assignedDrivers}
        editable={canManage}
        placeholder="Name(s) of the assigned driver(s)"
        onSave={(v) => onSaveVehicle({ assignedDrivers: v || undefined })}
      />

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
