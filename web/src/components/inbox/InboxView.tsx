import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Activity, CalendarClock, ChevronRight, Plus, Route, Truck, UserPlus } from 'lucide-react'
import type { Group } from '../../lib/types'
import type { RouteCountryLeg } from '../../lib/here/types'
import { groupLabel, tractorPlate } from '../../lib/types'
import { getOps, isTripActive } from '../../lib/vehicleOps'
import { loadHere } from '../../lib/here/loadHere'
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

  // Warm the HERE SDK while the workspace home sits idle, so the first map open
  // (Route planner here, or a vehicle room's Trip route) skips the script
  // download + parse it would otherwise pay after the click. This is the app's
  // default landing view, so nearly every session warms early. loadHere() is
  // cached and idempotent — repeat mounts and the later real open reuse the
  // same promise — and it resets itself on failure, so an unconfigured/offline
  // HERE just stays cold (the swallow keeps the warm-up silent; the real open
  // still surfaces its own error).
  useEffect(() => {
    const warm = () => void loadHere().catch(() => {})
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

  return (
    <>
      <header className="h-[var(--header-height)] flex flex-col justify-center px-5 shrink-0">
        <div className="text-xl font-semibold tracking-[-0.2px] leading-tight">Workspace</div>
        <div className="text-sm text-muted leading-tight mt-0.5">Operational tools for {workspaceName}.</div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-[57.5rem] mx-auto flex flex-col gap-6">
          <section>
            <div className="eyebrow mb-2">Tools</div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(17.5rem,1fr))]">
              <ToolCard
                icon={<Route size="1.25rem" strokeWidth={1.6} />}
                title="Route planner"
                subtitle="Plan a truck route with distance, tolls and ETA."
                meta={ROUTE_META}
                onClick={() => setTool('route')}
              />
              <ToolCard
                icon={<CalendarClock size="1.25rem" strokeWidth={1.6} />}
                title="Restriction calculator"
                subtitle="When the truck arrives, once bans and rests are counted."
                meta={RESTRICTION_META}
                onClick={() => setTool('restrictions')}
              />
              <ToolCard
                icon={<Activity size="1.25rem" strokeWidth={1.6} />}
                title="Fleet status"
                subtitle="Vehicles, their current trips and availability."
                meta={fleetMeta}
                onClick={() => setTool('fleet')}
              />
            </div>
          </section>

          <section>
            <div className="eyebrow mb-2">Quick actions</div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
              <ActionCard
                icon={<Truck size="1.0625rem" strokeWidth={1.6} />}
                title="Create vehicle room"
                subtitle="A permanent room per truck"
                onClick={onCreateVehicleRoom}
              />
              {canAddTrip && (
                <ActionCard
                  icon={<Plus size="1.0625rem" strokeWidth={1.7} />}
                  title="Add trip"
                  subtitle="Choose a vehicle room"
                  onClick={() => setTripPickerOpen(true)}
                />
              )}
              <ActionCard
                icon={<UserPlus size="1.0625rem" strokeWidth={1.6} />}
                title="Add connection"
                subtitle="Connect across companies"
                onClick={onAddConnection}
              />
            </div>
          </section>
        </div>
      </div>
      {tripPickerOpen && (
        <VehicleRoomPicker
          rooms={vehicleRooms}
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

// One segment of a tool card's foot line. `alert` marks the one count that
// wants attention (vehicles in service) so it reads without a chip.
type MetaPart = { label: string; alert?: boolean }

// The Route planner has nothing live to report, so its foot line names what the
// tool covers instead — the same shape as the fleet counts, so the two cards
// stay symmetrical.
// Like the planner's, a foot line naming what the tool covers rather than a
// live count — there is nothing running to report on.
const RESTRICTION_META: MetaPart[] = [
  { label: 'Driving bans' },
  { label: 'Rests' },
  { label: 'Arrival' },
]

const ROUTE_META: MetaPart[] = [
  { label: 'HGV profiles' },
  { label: 'Tolls' },
  { label: 'Saved places' },
]

// A destination: opens its own workspace in place. Stacked so the accent glyph,
// the name and the foot line each get their own line — the foot line is pushed
// down by `mt-auto` so it sits on the same baseline across the row even when
// one subtitle wraps and another doesn't.
function ToolCard({
  icon,
  title,
  subtitle,
  meta,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  meta: MetaPart[]
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-soft border border-line bg-white/2 p-4 text-left transition-colors hover:border-line hover:bg-white/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile border border-active/20 bg-active/10 text-active">
          {icon}
        </span>
        <ChevronRight
          size="1rem"
          strokeWidth={1.7}
          className="ml-auto shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
        />
      </span>
      <span className="mt-3 block text-lg font-semibold tracking-[-0.2px]">{title}</span>
      <span className="mt-1 mb-3.5 block text-base leading-[1.5] text-muted">{subtitle}</span>
      <span className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5 text-xs text-faint">
        {meta.map((part, index) => (
          <Fragment key={part.label}>
            {index > 0 && <span aria-hidden className="text-white/16">·</span>}
            <span className={part.alert ? 'text-alert' : undefined}>{part.label}</span>
          </Fragment>
        ))}
      </span>
    </button>
  )
}

// An action: opens a dialog and returns you here. Compact, neutral glyph and no
// chevron, so it never competes with the tool cards above it.
function ActionCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-soft border border-line bg-white/2 px-3.5 py-3 text-left transition-colors hover:border-line hover:bg-white/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile border border-line bg-white/4 text-muted transition-colors group-hover:text-text">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium tracking-[-0.1px]">{title}</span>
        {/* Wraps rather than truncates: the pane can get narrow when the rail is
            wide, and a clipped half-sentence reads worse than a second line. */}
        <span className="mt-0.5 block text-xs leading-tight text-faint">{subtitle}</span>
      </span>
    </button>
  )
}
