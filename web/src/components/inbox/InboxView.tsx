import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  CalendarClock,
  ChevronRight,
  MapPinOff,
  Plus,
  Route,
  Truck,
  UserPlus,
  UserX,
  Wrench,
} from 'lucide-react'
import type { Group } from '../../lib/types'
import type { RouteCountryLeg } from '../../lib/here/types'
import { groupLabel, tractorPlate, trailerPlate } from '../../lib/types'
import {
  getOps,
  isTripActive,
  labelOf,
  nextPlannedStop,
  STOP_TYPES,
  stopLocationLabel,
  tripSummary,
  VEHICLE_STATUSES,
  vehicleDriverIds,
  vehicleStatusTone,
  type ChipTone,
  type TripPlace,
} from '../../lib/vehicleOps'
import {
  DRIVER_EXPIRE_MS,
  driverLocationAgo,
  formatDuration,
  parseDriverLocations,
} from '../../lib/driverLocation'
import { RowMeta } from '../../pages/sidebarBits'
import { TONE_TEXT } from '../vehicle/opsControls'
import CountryFlag from '../CountryFlag'
import { loadGoogle } from '../../lib/google/loadGoogle'
import { PaneLoader } from '../LazyFallback'
import GroupAvatar from '../GroupAvatar'
import Modal from '../Modal'
import FleetStatus from './FleetStatus'

// The Route planner pulls in the whole HERE map stack (@here/flexpolyline, the
// HERE SDK loader, truck presets). Code-split so none of it ships in the initial
// bundle — it loads only when the user opens the tool.
const RoutePlanner = lazy(() => import('./RoutePlanner'))

// Split for its own sake rather than its weight: it is pure date arithmetic and
// a form, but it is only ever opened deliberately, so it has no business in the
// initial bundle either.
const RestrictionCalculator = lazy(() => import('./RestrictionCalculator'))

type Props = {
  workspaceName: string
  vehicleRooms: Group[]
  // The subset of vehicleRooms the user may add a trip to (lib/roomPermissions):
  // Fleet status shows every room, the Add trip picker only these.
  tripRooms: Group[]
  canAddTrip: boolean
  onAddTrip: (groupId: string) => void
  onCreateVehicleRoom: () => void
  onAddConnection: () => void
  onOpenVehicleRoom: (groupId: string) => void
}

// The Inbox / workspace home — reached by clicking the sidebar company header.
// It's an operational tools area, split into two tiers because the entries are
// not the same KIND of thing:
//
//   Tools          — Route planner, Fleet status. They open a dedicated
//                    workspace in place (replacing the chat area) with a back
//                    action returning here, so they read as destinations: large
//                    cards, accent glyph, a chevron, and a meta line at the
//                    foot carrying live signal (fleet counts) or what the tool
//                    covers.
//   Quick actions  — Create vehicle room, Add trip, Add connection. They open a
//                    dialog and leave you where you are, so they stay compact,
//                    neutral-glyphed and chevron-free.
//
// Both grids are auto-fit so future entries flow in alongside.
export default function InboxView({
  workspaceName,
  vehicleRooms,
  tripRooms,
  canAddTrip,
  onAddTrip,
  onCreateVehicleRoom,
  onAddConnection,
  onOpenVehicleRoom,
}: Props) {
  const [tool, setTool] = useState<'route' | 'fleet' | 'restrictions' | null>(null)
  // The route legs the planner handed over, kept HERE rather than inside the
  // calculator so they survive a trip back to the planner to adjust the route —
  // which is the normal way this pair gets used, not an edge case.
  const [restrictionLegs, setRestrictionLegs] = useState<RouteCountryLeg[] | null>(null)
  const [tripPickerOpen, setTripPickerOpen] = useState(false)

  // Live counts for the Fleet status card's meta line. Deliberately the SAME
  // buckets as FleetStatus's filter pills — service wins over an attached trip
  // there too — so the number on the card and the number behind it agree.
  const fleetMeta = useMemo<MetaPart[]>(() => {
    let onTrip = 0
    let service = 0
    for (const room of vehicleRooms) {
      const ops = getOps(room)
      if (ops.vehicle.status === 'service' || ops.trip?.status === 'service') service += 1
      else if (ops.trip && isTripActive(ops.trip.status)) onTrip += 1
    }
    if (vehicleRooms.length === 0) return [{ label: 'No vehicle rooms yet' }]
    const parts: MetaPart[] = [
      { label: vehicleRooms.length === 1 ? '1 vehicle' : `${vehicleRooms.length} vehicles` },
    ]
    if (onTrip > 0) parts.push({ label: `${onTrip} on a trip` })
    if (service > 0) parts.push({ label: `${service} in service`, alert: true })
    if (onTrip === 0 && service === 0) parts.push({ label: 'all available' })
    return parts
  }, [vehicleRooms])

  // Ages ("12 min ago") and the stale threshold move with the clock, not only
  // with new pings — a truck that went quiet has to turn up on its own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const fleetRows = useMemo(() => vehicleRooms.map((room) => buildFleetRow(room, now)), [vehicleRooms, now])

  // Warm the Google Maps API while the workspace home sits idle, so the first
  // map open (Route planner here, or a vehicle room's Trip route) skips the
  // script download + parse it would otherwise pay after the click. This is
  // the app's default landing view, so nearly every session warms early.
  // Google is what every map opens with now; HERE's SDK only loads when the
  // HGV overlay is asked for, so it stays cold here. loadGoogle() is cached
  // and idempotent — repeat mounts and the later real open reuse the same
  // promise — and it resets itself on failure, so a missing key or an offline
  // CDN just stays cold (the swallow keeps the warm-up silent; the real open
  // still surfaces its own error).
  useEffect(() => {
    const warm = () => void loadGoogle().catch(() => {})
    // requestIdleCallback is still missing on some Safari versions at runtime
    // (the DOM types always declare it) — fall back to a short timeout there.
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(warm, { timeout: 3000 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(warm, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  if (tool === 'route') {
    return (
      <Suspense fallback={<PaneLoader className="h-full" />}>
        <RoutePlanner
          onBack={() => setTool(null)}
          onCalculateRestrictions={(legs) => {
            setRestrictionLegs(legs)
            setTool('restrictions')
          }}
        />
      </Suspense>
    )
  }

  if (tool === 'restrictions') {
    return (
      <Suspense fallback={<PaneLoader className="h-full" />}>
        <RestrictionCalculator
          legs={restrictionLegs}
          onBack={() => setTool(null)}
          onPlanRoute={() => setTool('route')}
        />
      </Suspense>
    )
  }

  if (tool === 'fleet') {
    return (
      <FleetStatus
        rooms={vehicleRooms}
        onOpenRoom={onOpenVehicleRoom}
        onBack={() => setTool(null)}
      />
    )
  }

  // ── "Today" board (rework, 2026-10-10) ─────────────────────────────────
  // The home used to be a kit of identical cards. It is now the board a
  // dispatcher opens the day on: the company and its live counts, every truck
  // as a row with its trip drawn as a track, what needs attention, and the
  // tools as a plain list. Built from the same ops blob and driver pings the
  // rooms already carry — nothing here is fetched for this screen alone.
  const attention = fleetRows.flatMap((row) => row.attention)
  const headerCounts = [
    ...fleetMeta.map((part) => part.label),
    attention.length > 0
      ? `${attention.length} need${attention.length === 1 ? 's' : ''} attention`
      : null,
  ]

  return (
    <>
      <header className="h-[var(--header-height)] shrink-0 flex items-center gap-4 border-b border-line px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-bold tracking-[-0.02em] leading-tight">{workspaceName}</h1>
          <div className="mt-0.5 text-base text-muted">
            <RowMeta segments={headerCounts} whole />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <HomeButton onClick={onAddConnection} icon={<UserPlus size="0.9375rem" strokeWidth={1.7} />}>
            Add connection
          </HomeButton>
          {canAddTrip && (
            <HomeButton onClick={() => setTripPickerOpen(true)} icon={<Plus size="0.9375rem" strokeWidth={1.8} />}>
              Add trip
            </HomeButton>
          )}
          <HomeButton primary onClick={onCreateVehicleRoom} icon={<Truck size="0.9375rem" strokeWidth={1.7} />}>
            New vehicle room
          </HomeButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto flex max-w-[72rem] flex-col gap-9">
          <section aria-labelledby="home-fleet">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 id="home-fleet" className="text-xl font-semibold">Fleet</h2>
              <button
                type="button"
                onClick={() => setTool('fleet')}
                className="text-base font-medium text-muted underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:underline"
              >
                Open fleet status
              </button>
            </div>
            <div className="overflow-x-auto border-t border-line">
              <div className="min-w-[52rem]">
                <div className={`${FLEET_GRID} border-b border-line py-2.5 text-sm font-medium text-muted`}>
                  <span>Vehicle</span>
                  <span>Status</span>
                  <span>Trip</span>
                  <span>Next</span>
                  <span>Last position</span>
                </div>
                {fleetRows.map((row) => (
                  <FleetRow key={row.room.id} row={row} onOpen={() => onOpenVehicleRoom(row.room.id)} />
                ))}
                {/* No add row here: "New vehicle room" in the header is the
                    one way in (user, 2026-10-10). An empty fleet only says
                    where that is. */}
                {fleetRows.length === 0 && (
                  <p className="border-b border-line py-3.5 text-base text-muted">
                    No vehicle rooms yet. Use New vehicle room above to add your first truck.
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-x-12 gap-y-9">
            <section aria-labelledby="home-attention" className="min-w-0 flex-[1_1_22rem]">
              <h2 id="home-attention" className="mb-3 text-xl font-semibold">Needs attention</h2>
              <div className="border-t border-line">
                {attention.length === 0 ? (
                  <p className="border-b border-line py-3.5 text-base text-muted">
                    Nothing right now. Trucks without a driver or without a recent position show up here.
                  </p>
                ) : (
                  attention.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onOpenVehicleRoom(item.roomId)}
                      className="flex w-full items-start gap-3 border-b border-line py-3.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:bg-white/4"
                    >
                      <span className={`mt-0.5 shrink-0 ${TONE_TEXT[item.tone]}`}>{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-semibold">{item.title}</span>
                        <span className="mt-0.5 block text-base leading-[1.45] text-muted">{item.detail}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section aria-labelledby="home-tools" className="min-w-0 flex-[1_1_22rem]">
              <h2 id="home-tools" className="mb-3 text-xl font-semibold">Tools</h2>
              <div className="border-t border-line">
                <ToolRow
                  icon={<Route size="1.0625rem" strokeWidth={1.6} />}
                  title="Route planner"
                  subtitle="Plan a truck route with distance, tolls and ETA."
                  onClick={() => setTool('route')}
                />
                <ToolRow
                  icon={<CalendarClock size="1.0625rem" strokeWidth={1.6} />}
                  title="Restriction calculator"
                  subtitle="When the truck arrives, once bans and rests are counted."
                  onClick={() => setTool('restrictions')}
                />
                <ToolRow
                  icon={<Activity size="1.0625rem" strokeWidth={1.6} />}
                  title="Fleet status"
                  subtitle="Vehicles, their current trips and availability."
                  onClick={() => setTool('fleet')}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
      {tripPickerOpen && (
        <VehicleRoomPicker
          rooms={tripRooms}
          onSelect={(groupId) => {
            setTripPickerOpen(false)
            onAddTrip(groupId)
          }}
          onClose={() => setTripPickerOpen(false)}
        />
      )}
    </>
  )
}

export function VehicleRoomPicker({
  rooms,
  onSelect,
  onClose,
}: {
  rooms: Group[]
  onSelect: (groupId: string) => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Add trip"
      subtitle="Choose the vehicle room where the trip should be created."
      onClose={onClose}
    >
      <div className="-mx-2 max-h-[22rem] overflow-y-auto">
        {rooms.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-base text-muted">No vehicle rooms available.</div>
            <div className="mt-1 text-xs text-faint">
              Create a vehicle room before adding a trip.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {rooms.map((room) => {
              const hasTrip = Boolean(getOps(room).trip)
              const plate = tractorPlate(room)
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => onSelect(room.id)}
                  className="group flex w-full items-center gap-3 rounded-card px-2.5 py-2.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <GroupAvatar
                    groupId={room.id}
                    hasAvatar={Boolean(room.hasAvatar)}
                    version={room.avatarVersion}
                    shape="rounded"
                    size={38}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-text">
                      {groupLabel(room)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[plate && `Truck ${plate}`, hasTrip ? 'Current trip will be replaced' : 'Ready for a new trip']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronRight
                    size="1rem"
                    strokeWidth={1.7}
                    className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

// One live count for the header line. `alert` marks the count that wants
// attention (vehicles in service).
type MetaPart = { label: string; alert?: boolean }

// ── Fleet board rows ─────────────────────────────────────────────────────────

// The five columns, shared by the header row and every vehicle row so the cells
// line up. The board scrolls sideways inside its own box below ~52rem.
const FLEET_GRID =
  'grid grid-cols-[minmax(13rem,1.3fr)_minmax(9rem,1fr)_minmax(14rem,1.6fr)_minmax(10rem,1fr)_minmax(9rem,0.9fr)] gap-x-6'

// A driver who has not pinged for this long on an active trip is worth a look.
// Long enough that a tunnel or a phone in a pocket doesn't raise it; short
// enough that a dead phone is noticed the same morning.
const QUIET_AFTER_MS = 60 * 60_000

// "3 h 20 min" for a quiet afternoon, "5 days" for a phone that was never
// switched back on — nobody reads "821 h" as a number of days.
function quietFor(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  if (days >= 2) return `${days} days`
  return formatDuration(ms)
}

type AttentionItem = {
  key: string
  roomId: string
  tone: ChipTone
  icon: ReactNode
  title: string
  detail: string
}

type FleetRowData = {
  room: Group
  name: string
  plate?: string
  statusLabel: string
  tone: ChipTone
  from?: TripPlace
  to?: TripPlace
  /** Trip completion 0..1, or null when there is no trip to draw. */
  pct: number | null
  next?: { label: string; when?: string }
  position?: { who: string; ago: string; quiet: boolean }
  attention: AttentionItem[]
}

// Everything one row shows, read off the room's ops blob and its stored driver
// pings. Pure, so the board recomputes cheaply on every tick.
function buildFleetRow(room: Group, now: number): FleetRowData {
  const ops = getOps(room)
  const trip = tripSummary(ops)
  const vehicleStatus = ops.vehicle.status
  const name = groupLabel(room)
  const active = Boolean(ops.trip && isTripActive(ops.trip.status))

  const places = trip?.routePlaces ?? []
  const next = nextPlannedStop(ops.stops)

  const tripId = ops.trip ? (ops.trip.id ?? room.id) : undefined
  const latest = tripId
    ? Object.values(parseDriverLocations(room.meta?.driverLocations, tripId)).sort(
        (a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
      )[0]
    : undefined
  const ageMs = latest ? now - Date.parse(latest.recordedAt) : null
  const fresh = latest && ageMs !== null && ageMs < DRIVER_EXPIRE_MS ? latest : undefined

  const attention: AttentionItem[] = []
  if (vehicleStatus === 'service') {
    attention.push({
      key: `${room.id}:service`,
      roomId: room.id,
      tone: 'alert',
      icon: <Wrench size="1.0625rem" strokeWidth={1.8} />,
      title: `${name} is in service`,
      detail: 'Not available for a trip until its status is set back.',
    })
  }
  if (active && vehicleDriverIds(ops).length === 0) {
    attention.push({
      key: `${room.id}:driver`,
      roomId: room.id,
      tone: 'active',
      icon: <UserX size="1.0625rem" strokeWidth={1.8} />,
      title: `${name} has no driver assigned`,
      detail: 'Assign one in the room so the trip shows up on their phone.',
    })
  } else if (active && (ageMs === null || ageMs > QUIET_AFTER_MS)) {
    attention.push({
      key: `${room.id}:position`,
      roomId: room.id,
      tone: 'active',
      icon: <MapPinOff size="1.0625rem" strokeWidth={1.8} />,
      title:
        ageMs === null
          ? `${name} has not sent a position on this trip`
          : `${name} has not sent a position for ${quietFor(ageMs)}`,
      detail: 'Ask the driver to open the Dispo-chat app so the trip is tracked.',
    })
  }

  return {
    room,
    name,
    plate: tractorPlate(room) ?? trailerPlate(room),
    statusLabel: trip
      ? trip.statusLabel
      : vehicleStatus
        ? labelOf(VEHICLE_STATUSES, vehicleStatus)
        : 'No trip',
    tone: trip ? trip.statusTone : vehicleStatus ? vehicleStatusTone(vehicleStatus) : 'muted',
    from: places[0],
    to: places.length > 1 ? places[places.length - 1] : undefined,
    pct: trip ? Math.max(0, Math.min(1, trip.progress?.pct ?? 0)) : null,
    next: next
      ? {
          label: [labelOf(STOP_TYPES, next.type), stopLocationLabel(next)].filter(Boolean).join(', '),
          when: next.plannedAt?.trim() || undefined,
        }
      : undefined,
    position: fresh
      ? {
          who: fresh.name,
          ago: driverLocationAgo(fresh.recordedAt, now),
          quiet: (ageMs ?? 0) > QUIET_AFTER_MS,
        }
      : undefined,
    attention,
  }
}

// A place as the board shows it: flag + town, postal code dropped.
function BoardPlace({ place, align = 'start' }: { place: TripPlace; align?: 'start' | 'end' }) {
  const text =
    place.text
      .split(/\s+/)
      .filter((token) => token && !/\d/.test(token))
      .join(' ') || place.text
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${align === 'end' ? 'justify-end' : ''}`}>
      <CountryFlag code={place.code} />
      <span className="truncate" title={place.text}>
        {text}
      </span>
    </span>
  )
}

function FleetRow({ row, onOpen }: { row: FleetRowData; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${FLEET_GRID} w-full items-center border-b border-line py-3.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:bg-white/4`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <GroupAvatar
          groupId={row.room.id}
          hasAvatar={Boolean(row.room.hasAvatar)}
          version={row.room.avatarVersion}
          shape="rounded"
          size={38}
        />
        <span className="min-w-0">
          <span className="block truncate text-xl font-bold tracking-[-0.015em] tabular-nums">{row.name}</span>
          {row.plate && row.plate !== row.name && (
            <span className="block truncate text-sm text-muted">{row.plate}</span>
          )}
        </span>
      </span>

      <span className={`flex min-w-0 items-center gap-2 ${TONE_TEXT[row.tone]}`}>
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
        <span className="truncate text-lg font-medium text-text">{row.statusLabel}</span>
      </span>

      <span className="flex min-w-0 flex-col gap-2">
        {row.from ? (
          <>
            <span className="flex min-w-0 justify-between gap-3 text-base text-muted">
              <BoardPlace place={row.from} />
              {row.to && <BoardPlace place={row.to} align="end" />}
            </span>
            {row.pct !== null && (
              <span aria-hidden className={`relative h-0.5 rounded-full bg-line ${TONE_TEXT[row.tone]}`}>
                <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${row.pct * 100}%` }} />
                <span
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
                  style={{ left: `${row.pct * 100}%` }}
                />
              </span>
            )}
          </>
        ) : (
          <span className="text-base text-muted">No stops</span>
        )}
      </span>

      <span className="min-w-0">
        {row.next ? (
          <>
            <span className="block truncate text-lg">{row.next.label}</span>
            {row.next.when && <span className="block truncate text-sm text-muted tabular-nums">{row.next.when}</span>}
          </>
        ) : (
          <span className="text-base text-muted">Nothing planned</span>
        )}
      </span>

      <span className="min-w-0">
        {row.position ? (
          <>
            <span className="block truncate text-lg">{row.position.who}</span>
            <span className={`block truncate text-sm tabular-nums ${row.position.quiet ? 'text-active' : 'text-muted'}`}>
              {row.position.ago}
            </span>
          </>
        ) : (
          <span className="text-base text-muted">No position</span>
        )}
      </span>
    </button>
  )
}

// A tool as a list row: tile, name over what it does, chevron. A destination,
// so it gets the chevron; the header buttons above are actions and do not.
function ToolRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 border-b border-line py-3.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:bg-white/4"
    >
      <span className="flex h-[2.375rem] w-[2.375rem] shrink-0 items-center justify-center rounded-tile border border-line text-muted transition-colors group-hover:text-text">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">{title}</span>
        <span className="mt-0.5 block text-base leading-[1.45] text-muted">{subtitle}</span>
      </span>
      <ChevronRight
        size="1rem"
        strokeWidth={1.7}
        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </button>
  )
}

// The header's actions: hairline controls, with the one primary action filled.
function HomeButton({
  icon,
  primary = false,
  onClick,
  children,
}: {
  icon: ReactNode
  primary?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-btn px-3.5 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        primary ? 'bg-text font-semibold text-bg hover:bg-white' : 'border border-line text-text hover:bg-white/6'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
