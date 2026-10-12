import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { decode } from '@here/flexpolyline'
import { Pencil, X } from 'lucide-react'
import { PANEL_SURFACE } from '../settings/profileChrome'
import { ICON_ACTION_BASE_LG, ICON_ACTION_IDLE } from '../HeaderIconButton'
import { RowMeta, RowTile } from '../../pages/sidebarBits'
import { TONE_TEXT } from './opsControls'
import { getSocket } from '../../lib/socket'
import {
  DRIVER_EXPIRE_MS,
  DRIVER_STALE_MS,
  driverLocationAgo,
  formatDistance,
  metersBetween,
  parseDriverLocationEvent,
  parseDriverLocations,
  type DriverLocation,
} from '../../lib/driverLocation'
import {
  isRouteVia,
  labelOf,
  nextPlannedStop,
  STOP_TYPES,
  vehicleDriverIds,
  type TripStop,
  type TripSummary,
  type VehicleOps,
} from '../../lib/vehicleOps'
import type { Group, GroupMember } from '../../lib/types'

// ── Trip panel ──────────────────────────────────────────────────────────────
// The vehicle room's trip, kept OPEN beside the thread instead of folded into a
// strip above it (rework, 2026-10-10: "the trip becomes the spine"). Drawn to
// the rework canvas: a column on the same hairline seam as the rail↔thread one
// (no card, no gap), its header the thread header's height so the two rules
// meet, then status → itinerary → route → load → crew as hairline-separated
// sections.
//
// It shares the right-hand slot with Group info / Add trip / a profile and
// yields to all of them: those are things you opened on purpose, this is the
// resting state. Read-only by design — every edit still happens in Group info's
// Trip tab, which the pencil opens, so there is one place to change a trip.

type Props = {
  group: Group
  ops: VehicleOps
  trip: TripSummary
  members: GroupMember[]
  /** The viewer's own company — a crew member from elsewhere gets theirs named. */
  viewerWorkspace: string
  /** Whether the viewer may edit the trip (shows the pencil). */
  canEdit: boolean
  onClose: () => void
  onEditTrip: () => void
  /** Opens Group info on the Members tab. */
  onOpenMembers: () => void
  /** Opens the Trip route map tab; undefined when the stops can't be routed. */
  onOpenRoute?: () => void
  onOpenProfile: (userId: string, name: string) => void
}

export default function TripPanel({
  group,
  ops,
  trip,
  members,
  viewerWorkspace,
  canEdit,
  onClose,
  onEditTrip,
  onOpenMembers,
  onOpenRoute,
  onOpenProfile,
}: Props) {
  const tripId = ops.trip ? (ops.trip.id ?? group.id) : undefined
  const { locations, now } = useLiveDriverLocations(group, tripId)
  const tone = trip.statusTone

  // The freshest non-expired position across the assigned drivers. One truck,
  // so one marker — two phones in the same cab would otherwise draw two.
  const live = Object.values(locations)
    .filter((l) => now - Date.parse(l.recordedAt) < DRIVER_EXPIRE_MS)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0]

  // Straight-line distance from the truck to the stop it is heading for, said
  // as such: it is not a road distance.
  const next = nextPlannedStop(ops.stops)
  const toNextM =
    live && next && typeof next.lat === 'number' && typeof next.lng === 'number'
      ? metersBetween(live, { lat: next.lat, lng: next.lng, at: 0 })
      : null
  const nextType = next ? (labelOf(STOP_TYPES, next.type) || 'next stop').toLowerCase() : 'next stop'

  const stops = trip.stops
  const nextIndex = stops.findIndex((s) => s.status === 'planned')
  // The live position sits where the truck actually is in the sequence: after
  // the stops it has done and before the one it is driving to.
  const liveAt = nextIndex === -1 ? stops.length : nextIndex

  // Crew: the assigned drivers first, then the room's dispatchers.
  const driverIds = vehicleDriverIds(ops)
  const drivers = driverIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is GroupMember => Boolean(m))
  const dispatchers = members
    .filter((m) => !driverIds.includes(m.id) && (m.userRole === 'dispatcher' || m.userRole === 'admin'))
    .slice(0, 2)
  const crew = [
    ...drivers.map((m) => ({ member: m, role: 'Driver' })),
    ...dispatchers.map((m) => ({
      member: m,
      role: m.workspace && m.workspace !== viewerWorkspace ? `Dispatcher, ${m.workspace}` : 'Dispatcher',
    })),
  ]

  const t = ops.trip
  const details: Array<[string, string | undefined]> = [
    ['Client', t?.client],
    ['Cargo', t?.cargo],
    ['Weight', t?.weight],
    ['Pallets', t?.pallets],
  ]
  const shownDetails = details.filter(([, v]) => v?.trim())
  const routeOk = trip.route?.status === 'ok'

  return (
    <>
      {/* Click-away only while it is an overlay drawer (< xl), exactly like
          Group info. In-flow on desktop, so nothing to dismiss. */}
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />

      <aside
        aria-label="Trip"
        className={`panel-fade-in fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] shadow-drawer ${PANEL_SURFACE} flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(20rem,24vw,24rem)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:border-l xl:border-line`}
      >
        {/* Header — the thread header's height, so its rule continues the
            thread's across the seam. */}
        <div className="h-[var(--header-height)] shrink-0 flex items-center gap-2.5 border-b border-line pl-5 pr-3">
          <h2 className="text-xl font-semibold">Trip</h2>
          <span className="min-w-0 flex-1 text-base text-muted">
            <RowMeta segments={[t?.reference ? `#${t.reference}` : undefined, t?.client]} whole />
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={onEditTrip}
              aria-label="Edit trip"
              title="Edit trip"
              className={`${ICON_ACTION_BASE_LG} ${ICON_ACTION_IDLE} shrink-0`}
            >
              <Pencil size="1rem" strokeWidth={1.8} />
            </button>
          )}
          {/* The header's Trip button closes it on desktop; the drawer needs
              its own way out. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trip panel"
            title="Close trip panel"
            className={`${ICON_ACTION_BASE_LG} ${ICON_ACTION_IDLE} shrink-0 xl:hidden`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {/* Status — the one large thing in the column. */}
          <section className="px-5 pt-5 pb-1.5 flex flex-col gap-1">
            <div className={`flex items-center gap-2.5 ${TONE_TEXT[tone]}`}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-current" />
              <span className="text-3xl font-semibold tracking-[-0.015em] text-text">{trip.statusLabel}</span>
            </div>
            {trip.progress && trip.progress.total > 0 && (
              <span className="pl-5 text-base text-muted tabular-nums">
                {trip.progress.done} of {trip.progress.total} stops done
              </span>
            )}
          </section>

          {/* Itinerary — the stops down a line, with the truck on it. */}
          <section aria-label="Itinerary" className="px-5 pt-4 pb-2">
            {stops.length === 0 && !live ? (
              <p className="pb-3 text-base text-muted">No stops yet.</p>
            ) : (
              <ol className="flex flex-col">
                {stops.map((stop, index) => (
                  <ItineraryEntry
                    key={stop.id}
                    stop={stop}
                    next={index === nextIndex}
                    last={index === stops.length - 1 && !(live && liveAt === stops.length)}
                    before={
                      live && index === liveAt ? (
                        <LiveEntry live={live} now={now} toNextM={toNextM} nextType={nextType} />
                      ) : null
                    }
                  />
                ))}
                {live && liveAt === stops.length && (
                  <LiveEntry live={live} now={now} toNextM={null} nextType={nextType} last />
                )}
              </ol>
            )}
          </section>

          {/* Route — the trip's real geometry drawn small, with its numbers. */}
          {(routeOk || onOpenRoute) && (
            <section className="px-5 pb-5">
              <figure className="m-0 overflow-hidden rounded-card border border-line">
                <RouteSketch ops={ops} live={live} />
                <figcaption className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-base text-muted tabular-nums">
                  {routeOk ? (
                    <RowMeta segments={[trip.route?.distanceText, trip.route?.durationText]} />
                  ) : (
                    <span>Route not calculated yet</span>
                  )}
                  {onOpenRoute && (
                    <button
                      type="button"
                      onClick={onOpenRoute}
                      className="ml-auto shrink-0 font-semibold text-text hover:underline underline-offset-4 focus-visible:outline-none focus-visible:underline"
                    >
                      Open route map
                    </button>
                  )}
                </figcaption>
              </figure>
            </section>
          )}

          {shownDetails.length > 0 && (
            <Section title="Load">
              <dl className="flex flex-col gap-2.5 text-base">
                {shownDetails.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted">{label}</dt>
                    <dd className="min-w-0 truncate text-right tabular-nums" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <Section
            title="Crew"
            action={
              <button
                type="button"
                onClick={onOpenMembers}
                className="text-base font-semibold text-text hover:underline underline-offset-4 focus-visible:outline-none focus-visible:underline"
              >
                All {group.memberCount} members
              </button>
            }
            last
          >
            {crew.length === 0 ? (
              <p className="text-base text-muted">No driver assigned.</p>
            ) : (
              <ul className="-mx-2 flex flex-col gap-0.5">
                {crew.map(({ member: m, role }) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onOpenProfile(m.id, m.displayName)}
                      className="w-full flex items-center gap-2.5 rounded-card px-2 py-1.5 text-left transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                      <RowTile
                        kind="user"
                        id={m.id}
                        name={m.displayName}
                        hasAvatar={m.hasAvatar}
                        version={m.avatarVersion}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-medium">{m.displayName}</span>
                        <span className="block truncate text-sm text-muted">{role}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </aside>
    </>
  )
}

// A titled block, separated from the one above by a hairline — the column is
// a list of facts about one trip, not a stack of cards.
function Section({
  title,
  action,
  children,
  last = false,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  last?: boolean
}) {
  return (
    <section className={`border-t border-line px-5 pt-4 ${last ? 'pb-6' : 'pb-5'}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// The route marks are the map's own: a white disc with a black core (the
// black-on-white marks the planner draws). A stop already done keeps the shape
// but drops to the hairline grey, so the line reads as travelled up to there.
function StopMark({ done }: { done: boolean }) {
  return (
    <span
      className={`box-border h-3 w-3 shrink-0 rounded-full border-[3px] bg-bg ${
        done ? 'border-line-2' : 'border-text'
      }`}
    />
  )
}

// A row of the itinerary: the mark and the line down to the next mark in the
// left column, what the stop is in the right. `before` lets the live position
// slot in ahead of the stop the truck is driving towards.
function ItineraryEntry({
  stop,
  next,
  last,
  before,
}: {
  stop: TripStop
  next: boolean
  last: boolean
  before: ReactNode
}) {
  const done = stop.status === 'done'
  const place = stop.place.text || stop.place.code || '—'
  return (
    <>
      {before}
      <li className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-3">
        <span className="flex flex-col items-center" aria-hidden>
          <span className="mt-1 flex h-3 items-center">
            <StopMark done={done} />
          </span>
          {!last && <span className="my-1 w-0.5 flex-1 bg-line" />}
        </span>
        <span className={`min-w-0 flex flex-col gap-0.5 ${last ? 'pb-4' : 'pb-5'}`}>
          <span className="text-sm font-medium text-muted">
            {stop.typeLabel}
            {done ? ', done' : ''}
          </span>
          <span
            className={`truncate text-xl ${done ? 'font-medium text-muted' : 'font-semibold text-text'}`}
            title={place}
          >
            {place}
          </span>
          {stop.plannedAt && <span className="text-base text-text/75 tabular-nums">{stop.plannedAt}</span>}
          {stop.eta && <span className="text-base text-muted tabular-nums">ETA {stop.eta}</span>}
          {next && !stop.eta && !stop.plannedAt && <span className="text-base text-muted">Next stop</span>}
        </span>
      </li>
    </>
  )
}

// Where the truck is. Teal like the live marker on the map; muted once the
// last ping is older than the map's own stale threshold, so a phone that went
// quiet never reads as a truck that is still moving.
function LiveEntry({
  live,
  now,
  toNextM,
  nextType,
  last = false,
}: {
  live: DriverLocation
  now: number
  toNextM: number | null
  nextType: string
  last?: boolean
}) {
  const stale = now - Date.parse(live.recordedAt) > DRIVER_STALE_MS
  return (
    <li className="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-3">
      <span className="flex flex-col items-center" aria-hidden>
        <span className="mt-1 flex h-3 items-center">
          <span className={`h-3 w-3 rounded-full ${stale ? 'bg-muted' : 'bg-driven'}`} />
        </span>
        {!last && <span className="my-1 w-0.5 flex-1 bg-line" />}
      </span>
      <span className={`min-w-0 flex flex-col gap-0.5 ${last ? 'pb-4' : 'pb-5'}`}>
        <span className="text-sm font-medium text-muted">{stale ? 'Last known position' : 'Live position'}</span>
        <span className="truncate text-xl font-semibold">{live.name}</span>
        <span className="text-base text-text/75 tabular-nums">{driverLocationAgo(live.recordedAt, now)}</span>
        {toNextM !== null && (
          <span className={`text-base tabular-nums ${stale ? 'text-muted' : 'text-driven'}`}>
            {formatDistance(toNextM)} to {nextType}, straight line
          </span>
        )}
      </span>
    </li>
  )
}

// The route, drawn small: the stored HERE geometry (or straight legs between
// the stops when there is none yet) fitted into the box in cobalt, the stops as
// the map's black-on-white marks, the truck as the teal dot. A sketch, not a
// map — no tiles, no labels — so it costs nothing and never needs a key.
const SKETCH_W = 320
const SKETCH_H = 120
const SKETCH_PAD = 16

function RouteSketch({ ops, live }: { ops: VehicleOps; live: DriverLocation | undefined }) {
  const geometry = useMemo(() => {
    const stopPts = ops.stops
      .filter((s) => s.status !== 'cancelled' && !isRouteVia(s))
      .filter((s): s is typeof s & { lat: number; lng: number } => typeof s.lat === 'number' && typeof s.lng === 'number')
      .map((s) => ({ lat: s.lat, lng: s.lng }))
    let line: Array<{ lat: number; lng: number }> = []
    for (const encoded of ops.trip?.route?.polylines ?? []) {
      try {
        for (const [lat, lng] of decode(encoded).polyline) line.push({ lat, lng })
      } catch {
        // A malformed section is skipped; the rest of the route still draws.
      }
    }
    if (line.length < 2) line = stopPts
    return { line, stopPts }
  }, [ops.stops, ops.trip?.route?.polylines])

  const all = [...geometry.line, ...geometry.stopPts, ...(live ? [{ lat: live.lat, lng: live.lng }] : [])]
  if (all.length < 2) {
    return <div className="h-[7.5rem] flex items-center justify-center text-base text-muted">No coordinates yet</div>
  }

  // Equirectangular fit with the longitude squeezed by cos(latitude), which is
  // all a 320px sketch needs to keep a European route the right shape.
  const lats = all.map((p) => p.lat)
  const lngs = all.map((p) => p.lng)
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180)
  const kx = Math.cos(midLat)
  const minX = Math.min(...lngs) * kx
  const maxX = Math.max(...lngs) * kx
  const minY = Math.min(...lats)
  const maxY = Math.max(...lats)
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const scale = Math.min((SKETCH_W - SKETCH_PAD * 2) / spanX, (SKETCH_H - SKETCH_PAD * 2) / spanY)
  const offX = (SKETCH_W - spanX * scale) / 2
  const offY = (SKETCH_H - spanY * scale) / 2
  const project = (p: { lat: number; lng: number }) => ({
    x: offX + (p.lng * kx - minX) * scale,
    y: offY + (maxY - p.lat) * scale,
  })

  // Thin the line to roughly one vertex per pixel of sketch width.
  const step = Math.max(1, Math.floor(geometry.line.length / 400))
  const d = geometry.line
    .filter((_, i) => i % step === 0 || i === geometry.line.length - 1)
    .map((p, i) => {
      const { x, y } = project(p)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const livePt = live ? project(live) : null

  return (
    <svg
      viewBox={`0 0 ${SKETCH_W} ${SKETCH_H}`}
      className="block h-[7.5rem] w-full"
      role="img"
      aria-label="Route sketch"
    >
      <path d={d} fill="none" stroke="#1d4fc4" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {geometry.stopPts.map((p, i) => {
        const { x, y } = project(p)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={6} fill="#ffffff" />
            <circle cx={x} cy={y} r={2.5} fill="#000000" />
          </g>
        )
      })}
      {livePt && (
        <g>
          <circle cx={livePt.x} cy={livePt.y} r={7} fill="rgb(var(--color-driven))" fillOpacity={0.25} />
          <circle cx={livePt.x} cy={livePt.y} r={4} fill="rgb(var(--color-driven))" />
        </g>
      )}
    </svg>
  )
}

// Last-known driver positions for this trip: seeded from the room's stored
// blob, then kept live from the same `driver:location` socket events the route
// map listens to. `now` ticks every 30s so "3 min ago" and the stale state move
// without a new ping.
function useLiveDriverLocations(group: Group, tripId: string | undefined) {
  const seed = group.meta?.driverLocations
  const [locations, setLocations] = useState<Record<string, DriverLocation>>(() =>
    tripId ? parseDriverLocations(seed, tripId) : {},
  )
  useEffect(() => {
    setLocations(tripId ? parseDriverLocations(seed, tripId) : {})
  }, [seed, tripId])

  useEffect(() => {
    if (!tripId) return
    const socket = getSocket()
    const onLocation = (payload: unknown) => {
      const entry = parseDriverLocationEvent(payload, group.id, tripId)
      if (entry) setLocations((cur) => ({ ...cur, [entry.userId]: entry }))
    }
    socket.on('driver:location', onLocation)
    return () => {
      socket.off('driver:location', onLocation)
    }
  }, [group.id, tripId])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return { locations, now }
}
