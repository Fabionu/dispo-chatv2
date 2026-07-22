import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, Search, Truck, X } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel, tractorPlate, trailerPlate } from '../../lib/types'
import {
  getOps,
  isTripActive,
  labelOf,
  tripSummary,
  vehicleStatusTone,
  VEHICLE_STATUSES,
  type ChipTone,
} from '../../lib/vehicleOps'
import GroupAvatar from '../GroupAvatar'
import { StatusChip } from '../vehicle/opsControls'

type Props = {
  rooms: Group[]
  onOpenRoom: (groupId: string) => void
  onBack: () => void
}

type FleetFilter = 'all' | 'active' | 'available' | 'service'

type FleetRoom = {
  room: Group
  plateLine: string
  statusLabel: string
  statusTone: ChipTone
  tripLine: string
  nextLine: string
  active: boolean
  available: boolean
  attention: boolean
  searchText: string
}

function summarizeRoom(room: Group): FleetRoom {
  const ops = getOps(room)
  const active = Boolean(ops.trip && isTripActive(ops.trip.status))
  const summary = active ? tripSummary(ops) : null
  const vehicleStatus = ops.vehicle.status
  const service = vehicleStatus === 'service' || ops.trip?.status === 'service'
  const capPlate = tractorPlate(room)
  const remorcaPlate = trailerPlate(room)

  // An active trip is the most useful live signal. Outside a trip, retain the
  // manually-managed vehicle state. Service always wins because it requires
  // attention even when an old trip is still attached.
  const statusLabel = service
    ? 'Service'
    : summary?.statusLabel || labelOf(VEHICLE_STATUSES, vehicleStatus) || 'Available'
  const statusTone = service
    ? vehicleStatusTone('service')
    : summary?.statusTone ?? vehicleStatusTone(vehicleStatus)
  const plateLine = [
    capPlate && `Tractor ${capPlate}`,
    remorcaPlate && `Trailer ${remorcaPlate}`,
  ].filter(Boolean).join(' · ') || 'Registration not set'

  const tripLine = summary
    ? [ops.trip?.reference && `#${ops.trip.reference}`, ops.trip?.client]
        .filter(Boolean)
        .join(' · ') || 'Active trip'
    : 'No active trip'
  const routePlaces = summary?.routePlaces.map((place) => place.text).filter(Boolean) ?? []
  const routeLine = routePlaces.length > 1
    ? `${routePlaces[0]} → ${routePlaces[routePlaces.length - 1]}`
    : routePlaces[0]
  const nextLine = summary?.nextLabel
    ? `Next: ${summary.nextLabel}${ops.trip?.eta ? ` · ETA ${ops.trip.eta}` : ''}`
    : routeLine
      ? `${routeLine}${ops.trip?.eta ? ` · ETA ${ops.trip.eta}` : ''}`
      : ops.trip?.eta
        ? `ETA ${ops.trip.eta}`
        : active
          ? 'No stops added'
          : 'Ready for a new trip'
  const available = !active
    && !service
    && (!vehicleStatus || vehicleStatus === 'available' || vehicleStatus === 'completed')

  return {
    room,
    plateLine,
    statusLabel,
    statusTone,
    tripLine,
    nextLine,
    active,
    available,
    attention: service,
    searchText: [
      groupLabel(room),
      capPlate,
      remorcaPlate,
      ops.trip?.reference,
      ops.trip?.client,
      summary?.nextLabel,
      routeLine,
      statusLabel,
    ].filter(Boolean).join(' ').toLocaleLowerCase(),
  }
}

export default function FleetStatus({ rooms, onOpenRoom, onBack }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FleetFilter>('all')

  const fleet = useMemo(
    () => rooms.map(summarizeRoom).sort((a, b) =>
      Number(b.attention) - Number(a.attention)
        || Number(b.active) - Number(a.active)
        || groupLabel(a.room).localeCompare(groupLabel(b.room)),
    ),
    [rooms],
  )
  const counts: Record<FleetFilter, number> = {
    all: fleet.length,
    active: fleet.filter((item) => item.active && !item.attention).length,
    available: fleet.filter((item) => item.available).length,
    service: fleet.filter((item) => item.attention).length,
  }
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleFleet = fleet.filter((item) => {
    const matchesSearch = !normalizedQuery || item.searchText.includes(normalizedQuery)
    const matchesFilter = filter === 'all'
      || (filter === 'active' && item.active && !item.attention)
      || (filter === 'available' && item.available)
      || (filter === 'service' && item.attention)
    return matchesSearch && matchesFilter
  })

  return (
    <>
      <header className="h-[var(--header-height)] flex shrink-0 items-center gap-3 px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to workspace"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <ArrowLeft size="1rem" strokeWidth={1.8} />
        </button>
        <div className="min-w-0">
          <div className="text-[0.9375rem] font-semibold tracking-[-0.2px] leading-tight">Fleet status</div>
          <div className="mt-0.5 truncate text-[0.75rem] leading-tight text-muted">
            Vehicles, current trips and availability
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex max-w-[57.5rem] flex-col gap-4">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <label className="flex h-9 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.035] px-3 transition-colors hover:bg-white/[0.05] focus-within:border-white/[0.14] focus-within:bg-white/[0.05]">
              <Search size="0.875rem" strokeWidth={1.7} className="shrink-0 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search vehicle, registration, client or trip…"
                className="min-w-0 flex-1 bg-transparent text-[0.78125rem] outline-none placeholder:text-faint"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear fleet search"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/[0.06] hover:text-text"
                >
                  <X size="0.75rem" strokeWidth={1.8} />
                </button>
              )}
            </label>

            <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-full bg-white/[0.025] p-1">
              {([
                ['all', 'All'],
                ['active', 'Active'],
                ['available', 'Available'],
                ['service', 'Service'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`h-7 whitespace-nowrap rounded-full px-2.5 text-[0.6875rem] font-medium transition-colors ${
                    filter === value
                      ? 'bg-white/[0.09] text-text'
                      : 'text-muted hover:bg-white/[0.05] hover:text-text'
                  }`}
                >
                  {label} <span className="ml-0.5 tabular-nums text-faint">{counts[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-[0.6875rem] text-muted">
              {visibleFleet.length === 1 ? '1 vehicle' : `${visibleFleet.length} vehicles`}
            </span>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="text-[0.6875rem] text-muted transition-colors hover:text-text"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-panel border border-white/[0.06] bg-white/[0.012]">
            {fleet.length === 0 ? (
              <EmptyFleet />
            ) : visibleFleet.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-[0.78125rem] text-muted">No vehicles match your search</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                  className="mt-2 text-[0.71875rem] font-medium text-text hover:underline underline-offset-4"
                >
                  Show all vehicles
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {visibleFleet.map((item) => (
                  <FleetRow key={item.room.id} item={item} onOpenRoom={onOpenRoom} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function FleetRow({ item, onOpenRoom }: { item: FleetRoom; onOpenRoom: (groupId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenRoom(item.room.id)}
      aria-label={`Open ${groupLabel(item.room)}`}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)_auto]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <GroupAvatar
          groupId={item.room.id}
          hasAvatar={Boolean(item.room.hasAvatar)}
          shape="rounded"
          size={38}
        />
        <span className="min-w-0">
          <span className="block truncate text-[0.8125rem] font-semibold text-text">
            {groupLabel(item.room)}
          </span>
          <span className="mt-0.5 block truncate text-[0.6875rem] text-muted">
            {item.plateLine}
          </span>
        </span>
      </span>

      <span className="col-span-2 min-w-0 pl-[3.125rem] md:col-span-1 md:pl-0">
        <span className="block truncate text-[0.75rem] text-text">{item.tripLine}</span>
        <span className="mt-0.5 block truncate text-[0.6875rem] text-muted" title={item.nextLine}>
          {item.nextLine}
        </span>
      </span>

      <span className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 md:col-start-3">
        <StatusChip tone={item.statusTone} label={item.statusLabel} />
        <ChevronRight
          size="0.9375rem"
          strokeWidth={1.7}
          className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
        />
      </span>
    </button>
  )
}

function EmptyFleet() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.035] text-faint">
        <Truck size="1.125rem" strokeWidth={1.5} />
      </span>
      <p className="text-[0.78125rem] text-muted">No vehicles in the fleet yet</p>
      <p className="mt-0.5 text-[0.6875rem] text-faint">
        Create a vehicle room to make it appear here.
      </p>
    </div>
  )
}
