import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { decode } from '@here/flexpolyline'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'
import { PANEL_SURFACE } from '../settings/profileChrome'
import { ICON_ACTION_BASE, ICON_ACTION_BASE_LG, ICON_ACTION_IDLE } from '../HeaderIconButton'
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
import type { DriverMapMarker, RouteMarker } from '../../lib/here/types'

// The real map in the route card, loaded on demand: the Google loader is not
// something every vehicle room that merely has a trip should pay for up front.
const MapView = lazy(() => import('../map/MapView'))

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
  // Finished stops fold into one row; the live position and what is ahead stay.
  const [showDone, setShowDone] = useState(false)
  const doneCount = stops.filter((s) => s.status === 'done').length
  const lastVisible = (() => {
    for (let i = stops.length - 1; i >= 0; i--) if (showDone || stops[i].status !== 'done') return i
    return -1
  })()
  const arrival = stops.length ? stops[stops.length - 1].eta ?? stops[stops.length - 1].plannedAt : undefined

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
        {/* Header — kept slim (user, 2026-10-15: "narrower from top to bottom"):
            the tool-bar height rather than the thread header's, so it no longer
            meets the thread header's rule across the seam on purpose. */}
        <div className="h-[var(--tool-header-height)] shrink-0 flex items-center gap-2.5 border-b border-line pl-5 pr-2">
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
              className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
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

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-5 pt-4 [scrollbar-gutter:stable]">
          {/* Status — one summary card: the state, how far along, when it lands. */}
          <section className="rounded-soft border border-line px-4 py-3.5">
            <div className={`flex items-center gap-2.5 ${TONE_TEXT[tone]}`}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-current" />
              <span className="text-3xl font-semibold tracking-[-0.015em] text-text">{trip.statusLabel}</span>
              {live && (
                <span className="ml-auto text-sm text-muted tabular-nums">
                  {driverLocationAgo(live.recordedAt, now)}
                </span>
              )}
            </div>
            {trip.progress && trip.progress.total > 0 && (
              <>
                <div aria-hidden className={`mt-3 h-1.5 overflow-hidden rounded-full bg-line ${TONE_TEXT[tone]}`}>
                  <span
                    className="block h-full rounded-full bg-current"
                    style={{ width: `${Math.max(0, Math.min(1, trip.progress.pct ?? 0)) * 100}%` }}
                  />
                </div>
                <div className="mt-2.5 flex items-baseline justify-between gap-3 text-base tabular-nums">
                  <span className="text-muted">
                    {trip.progress.done} of {trip.progress.total} stops done
                  </span>
                  {arrival && <span>Arrives {arrival}</span>}
                </div>
              </>
            )}
          </section>

          {/* Route — the real map first: where the truck is says more than the list. */}
          {(routeOk || onOpenRoute) && (
            <figure className="m-0 overflow-hidden rounded-soft border border-line">
              <RouteMapPreview ops={ops} live={live} now={now} />
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
                    Open map
                  </button>
                )}
              </figcaption>
            </figure>
          )}

          {/* Itinerary — the stops down a line, with the truck on it. Finished
              stops fold into one row so the live position and what is ahead are
              what you see. */}
          <section aria-label="Itinerary">
            {doneCount > 0 && (
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="mb-2.5 flex w-full items-center gap-2 text-left text-base text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:underline"
              >
                <Check size="0.875rem" strokeWidth={2.4} className="text-done" aria-hidden />
                {doneCount} {doneCount === 1 ? 'stop' : 'stops'} done
                <ChevronDown
                  size="0.875rem"
                  strokeWidth={1.8}
                  className={`ml-auto transition-transform motion-reduce:transition-none ${showDone ? 'rotate-180' : ''}`}
                />
              </button>
            )}
            {stops.length === 0 && !live ? (
              <p className="pb-3 text-base text-muted">No stops yet.</p>
            ) : (
              <ol className="flex flex-col">
                {stops.map((stop, index) =>
                  stop.status === 'done' && !showDone ? null : (
                    <ItineraryEntry
                      key={stop.id}
                      stop={stop}
                      next={index === nextIndex}
                      last={index === lastVisible && !(live && liveAt === stops.length)}
                      before={
                        live && index === liveAt ? (
                          <LiveEntry live={live} now={now} toNextM={toNextM} nextType={nextType} />
                        ) : null
                      }
                    />
                  ),
                )}
                {live && liveAt === stops.length && (
                  <LiveEntry live={live} now={now} toNextM={null} nextType={nextType} last />
                )}
              </ol>
            )}
          </section>

          {shownDetails.length > 0 && (
            <section>
              <h3 className="mb-2 text-lg font-semibold">Load</h3>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-soft border border-line bg-line">
                {shownDetails.map(([label, value], i) => (
                  <div
                    key={label}
                    className={`bg-bg px-3 py-2.5 ${
                      shownDetails.length % 2 === 1 && i === shownDetails.length - 1 ? 'col-span-2' : ''
                    }`}
                  >
                    <dt className="text-sm text-muted">{label}</dt>
                    <dd className="mt-0.5 truncate text-base font-medium tabular-nums" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Crew — one line: who is on it, and the way to everyone. */}
          <section className="flex items-center gap-2.5 border-t border-line pt-3.5">
            {crew.length === 0 ? (
              <p className="flex-1 text-base text-muted">No driver assigned.</p>
            ) : (
              <button
                type="button"
                onClick={() =>
                  crew.length === 1
                    ? onOpenProfile(crew[0].member.id, crew[0].member.displayName)
                    : onOpenMembers()
                }
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <span className="flex shrink-0">
                  {crew.slice(0, 3).map(({ member: m }, i) => (
                    <span key={m.id} className={`rounded-full ring-2 ring-bg ${i > 0 ? '-ml-2' : ''}`}>
                      <RowTile
                        kind="user"
                        id={m.id}
                        name={m.displayName}
                        hasAvatar={m.hasAvatar}
                        version={m.avatarVersion}
                        size={32}
                      />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-medium">
                    {crew.map(({ member: m }) => m.displayName).join(', ')}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {Array.from(new Set(crew.map(({ role }) => role.split(',')[0]))).join(', ')}
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenMembers}
              className="shrink-0 text-base font-semibold text-text hover:underline underline-offset-4 focus-visible:outline-none focus-visible:underline"
            >
              All {group.memberCount}
            </button>
          </section>
        </div>
      </aside>
    </>
  )
}

// The route card's map: the REAL map (the one Open map opens), drawn small and
// not interactive — the card is a glance, and scrolling the panel must not zoom
// the map under the cursor. A trip with no calculated route falls back to the
// schematic sketch below, which needs no coordinates it does not have.
function RouteMapPreview({ ops, live, now }: { ops: VehicleOps; live: DriverLocation | undefined; now: number }) {
  const polylines = ops.trip?.route?.polylines ?? []
  const markers = useMemo<RouteMarker[]>(() => {
    const pts = ops.stops
      .filter((s) => s.status !== 'cancelled' && !isRouteVia(s))
      .filter((s): s is typeof s & { lat: number; lng: number } => typeof s.lat === 'number' && typeof s.lng === 'number')
    return pts.map((s, i) => ({
      id: s.id,
      kind: i === 0 ? 'origin' : i === pts.length - 1 ? 'destination' : 'stop',
      position: { lat: s.lat, lng: s.lng },
      label: i > 0 && i < pts.length - 1 ? String(i) : undefined,
    }))
  }, [ops.stops])
  const driverMarkers = useMemo<DriverMapMarker[]>(
    () =>
      live
        ? [
            {
              id: live.userId,
              name: live.name,
              position: { lat: live.lat, lng: live.lng },
              stale: now - Date.parse(live.recordedAt) > DRIVER_STALE_MS,
              ...(live.headingDeg !== undefined ? { headingDeg: live.headingDeg } : {}),
            },
          ]
        : [],
    [live, now],
  )
  if (polylines.length === 0) return <RouteSketch ops={ops} live={live} />
  return (
    // `pointer-events-none` makes it a picture; the map's own zoom / style
    // controls would not fit a card this small, so they are hidden with it.
    <div className="pointer-events-none relative h-[10.5rem] bg-surface-2 [&_.here-map-controls-host]:hidden">
      <Suspense fallback={null}>
        <MapView
          className="absolute inset-0"
          markers={markers}
          driverMarkers={driverMarkers}
          routePolylines={polylines}
          scaleRouteWidthWithZoom
          truckOverlay={false}
          objectsDraggable={false}
        />
      </Suspense>
    </div>
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
