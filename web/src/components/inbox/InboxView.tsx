import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronRight, MapPinned, Plus, Route } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel, tractorPlate } from '../../lib/types'
import { getOps } from '../../lib/vehicleOps'
import { loadHere } from '../../lib/here/loadHere'
import { PaneLoader } from '../LazyFallback'
import GroupAvatar from '../GroupAvatar'
import Modal from '../Modal'

// The Route planner pulls in the whole HERE map stack (@here/flexpolyline, the
// HERE SDK loader, truck presets). Code-split so none of it ships in the initial
// bundle — it loads only when the user opens the tool.
const RoutePlanner = lazy(() => import('./RoutePlanner'))

type Props = {
  workspaceName: string
  vehicleRooms: Group[]
  canAddTrip: boolean
  onAddTrip: (groupId: string) => void
}

// The Inbox / workspace home — reached by clicking the sidebar company header.
// It's an operational tools area: a grid of large tool cards. Selecting a tool
// opens its dedicated workspace in place (replacing the chat area), with a back
// action returning here. Today the only tool is the HERE "Route planner".
export default function InboxView({ workspaceName, vehicleRooms, canAddTrip, onAddTrip }: Props) {
  const [tool, setTool] = useState<'route' | 'places' | null>(null)
  const [tripPickerOpen, setTripPickerOpen] = useState(false)

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

  if (tool === 'route' || tool === 'places') {
    return (
      <Suspense fallback={<PaneLoader className="h-full" />}>
        <RoutePlanner onBack={() => setTool(null)} initialPlacesOpen={tool === 'places'} />
      </Suspense>
    )
  }

  return (
    <>
      <header className="h-[var(--header-height)] flex flex-col justify-center px-5 shrink-0">
        <div className="text-[0.9375rem] font-semibold tracking-[-0.2px] leading-tight">Workspace</div>
        <div className="text-[0.75rem] text-muted leading-tight mt-0.5">Operational tools for {workspaceName}.</div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-[57.5rem] mx-auto flex flex-col gap-4">
          {/* Auto-fill grid leaves room for future tools to flow in alongside. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
            <ToolCard
              icon={<Route size="1.625rem" strokeWidth={1.5} />}
              title="Route planner"
              subtitle="Truck routing, distance and ETA"
              onClick={() => setTool('route')}
            />
            <ToolCard
              icon={<MapPinned size="1.625rem" strokeWidth={1.5} />}
              title="Saved places"
              subtitle="Parking, depots, fuel and customers"
              onClick={() => setTool('places')}
            />
            {canAddTrip && (
              <ToolCard
                icon={<Plus size="1.625rem" strokeWidth={1.6} />}
                title="Add trip"
                subtitle="Choose a vehicle room and create a trip"
                onClick={() => setTripPickerOpen(true)}
              />
            )}
          </div>
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
            <div className="text-[0.78125rem] text-muted">No vehicle rooms available.</div>
            <div className="mt-1 text-[0.6875rem] text-faint">
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
                  className="group flex w-full items-center gap-3 rounded-card px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <GroupAvatar
                    groupId={room.id}
                    hasAvatar={Boolean(room.hasAvatar)}
                    shape="rounded"
                    size={38}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium text-text">
                      {groupLabel(room)}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.6875rem] text-muted">
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

function ToolCard({
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
      className="group flex items-center gap-3 rounded-panel border border-white/[0.06] bg-white/[0.015] px-4 py-3.5 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-active">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.875rem] font-semibold tracking-[-0.2px]">{title}</span>
        <span className="mt-0.5 block text-[0.75rem] leading-[1.5] text-muted">{subtitle}</span>
      </span>
      <ChevronRight
        size="1rem"
        strokeWidth={1.7}
        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </button>
  )
}
