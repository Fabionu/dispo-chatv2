import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, MapPin, Pencil, Trash2, X } from 'lucide-react'
import Spinner from '../Spinner'
import HereMap from '../here/HereMap'
import { api } from '../../lib/api'
import { bestInsertionIndex } from '../../lib/here/geo'
import { computeTripRoute, type TripRoute } from '../../lib/tripRoute'
import { parseCoordinates, stopId, type VehicleStop } from '../../lib/vehicleOps'
import type { LatLng, RouteMarker, RouteMarkerKind, ScreenGeoCandidate } from '../../lib/here/types'
import { MENU_SURFACE } from '../menuStyles'

type Props = {
  // The active trip's stops — the route + markers derive from their coordinates.
  stops: VehicleStop[]
  // The trip's last-computed route (if any) — used to draw the line instantly
  // before a fresh recompute returns.
  route?: TripRoute
  // Whether the current user may edit the route. Gated by the caller on the same
  // "manage this group" permission the server enforces on save; false hides the
  // Edit button entirely (read-only map).
  canEdit?: boolean
  // Persist the edited stops + the freshly computed route onto the active trip.
  // Called ONLY with a valid ('ok') route (see save()). Rejects on failure — the
  // map then stays in edit mode and surfaces the error, so no changes are lost.
  onSaveRoute?: (editedStops: VehicleStop[], route: TripRoute) => Promise<void>
}

// A stop's routing coordinate: the parsed lat/lng when present, else parsed from
// the raw `coordinates` text. Mirrors routablePoints() so markers, the route
// preview, and the availability gate all read coordinates the same way.
function stopCoord(s: VehicleStop): { lat: number; lng: number } | null {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng }
  return s.coordinates ? parseCoordinates(s.coordinates) : null
}

// The routable stops (those with a usable coordinate) in order, tagged with their
// real stop id so a marker drag/click maps back to the exact stop.
function routableStops(stops: VehicleStop[]): { id: string; lat: number; lng: number }[] {
  const out: { id: string; lat: number; lng: number }[] = []
  for (const s of stops) {
    const c = stopCoord(s)
    if (c) out.push({ id: s.id, lat: c.lat, lng: c.lng })
  }
  return out
}

// Signature over the routable coordinates in order — changes exactly when the
// route geometry inputs change (a point moved, added, or removed), so it drives
// both recompute and the dirty check.
function coordSig(stops: VehicleStop[]): string {
  return routableStops(stops)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join('|')
}

// A fresh intermediate stop created by dropping a point on the map. Carries only
// coordinates (+ the snapped road label as its free-text location) and the
// neutral 'other' type — it's a routing waypoint, editable in the Trip tab like
// any other stop afterwards.
function mapStop(pos: LatLng, label: string): VehicleStop {
  return {
    id: stopId(),
    type: 'other',
    status: 'planned',
    lat: pos.lat,
    lng: pos.lng,
    coordinates: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
    ...(label ? { location: label } : {}),
  }
}

// Right-click context menu (add a stop) + clicked-marker popover (remove a stop),
// positioned within the map region.
type MenuState = { x: number; y: number; lat: number; lng: number; zoom: number; candidates: ScreenGeoCandidate[] }
type MarkerMenuState = { id: string; kind: RouteMarkerKind; x: number; y: number }

// Map of the active trip's route, opened from the conversation header. Derives
// waypoints from the stop coordinates (origin → stops → destination), draws the
// saved line immediately, and recomputes from the current stops so distance /
// duration stay fresh. Planning data only — no live GPS/tracking.
//
// With `canEdit`, an "Edit route" mode lets a manager shape the route directly on
// the map (reusing the shared HERE map's drag + road-snap, the same the Route
// Planner uses): drag a stop marker to move it, right-click to add an
// intermediate stop, click a stop to remove it. Save recomputes and persists the
// route + stops and the server logs a "… edited the trip route" system message;
// Cancel discards.
export default function TripRouteMap({ stops, route, canEdit = false, onSaveRoute }: Props) {
  const [editing, setEditing] = useState(false)
  // Working copy of ALL stops while editing (so non-routable stops are preserved
  // on save); edits mutate only the affected stops.
  const [draftStops, setDraftStops] = useState<VehicleStop[]>(stops)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [markerMenu, setMarkerMenu] = useState<MarkerMenuState | null>(null)
  const regionRef = useRef<HTMLDivElement>(null)

  // Keep the draft in sync with upstream stops while NOT editing, so re-entering
  // edit mode (or a live update from another member) starts from the latest data.
  useEffect(() => {
    if (!editing) setDraftStops(stops)
  }, [stops, editing])

  // Everything downstream reads the draft while editing, the live stops otherwise.
  const activeStops = editing ? draftStops : stops
  const routable = useMemo(() => routableStops(activeStops), [activeStops])

  const sig = useMemo(() => routable.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|'), [routable])
  // The route is dirty (worth saving) once the edited stops differ from the saved
  // ones — prevents an accidental no-op save and a needless system message.
  const originalSig = useMemo(() => coordSig(stops), [stops])
  const dirty = editing && sig !== originalSig

  const [data, setData] = useState<TripRoute | null>(route?.status === 'ok' ? route : null)
  const [loading, setLoading] = useState(false)

  // Recompute whenever the coordinate signature changes (and on first open). In
  // edit mode this is the live preview as the user drags / adds / removes stops.
  useEffect(() => {
    if (routable.length < 2) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    computeTripRoute(activeStops).then((r) => {
      if (!cancelled) {
        setData(r)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // activeStops is captured via the coordinate signature; recompute on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const markers = useMemo<RouteMarker[]>(
    () =>
      routable.map((p, i) => ({
        id: p.id,
        kind: i === 0 ? 'origin' : i === routable.length - 1 ? 'destination' : 'stop',
        position: { lat: p.lat, lng: p.lng },
        label: i > 0 && i < routable.length - 1 ? String(i) : undefined,
      })),
    [routable],
  )

  // Prefer freshly-computed geometry. When editing, never fall back to the SAVED
  // polylines (they'd disagree with the edited draft); read-only can, so the line
  // shows instantly on open.
  const polylines = data?.polylines ?? (editing ? [] : route?.polylines) ?? []
  const center = !polylines.length && routable[0] ? { lat: routable[0].lat, lng: routable[0].lng } : null
  const ok = data?.status === 'ok'

  // Marker drag released (edit mode only) → snap the drop to a road via the SAME
  // screen-space snap the Route Planner uses, then move that stop's coordinate in
  // the draft. The recompute effect redraws the preview through the moved point.
  async function handleMarkerDragEnd(id: string, candidates: ScreenGeoCandidate[], zoom: number) {
    const release = candidates[0]
    if (!release) return
    let pos = { lat: release.lat, lng: release.lng }
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom })
      if (place?.position) pos = place.position
    } catch {
      /* snap unavailable — keep the raw release coordinate */
    }
    setDraftStops((cur) =>
      cur.map((s) =>
        s.id === id
          ? { ...s, lat: pos.lat, lng: pos.lng, coordinates: `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` }
          : s,
      ),
    )
  }

  // Right-click on the map → position the "Add stop" context menu, clamped inside
  // the map region.
  function openMenu(info: MenuState) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    setMarkerMenu(null)
    setMenu({
      ...info,
      x: Math.min(info.x, Math.max(0, w - 180)),
      y: Math.min(info.y, Math.max(0, h - 90)),
    })
  }

  // "Add stop" → snap the clicked point to a road, then insert it into the draft
  // on the least-detour leg between the existing waypoints (never before the
  // origin or after the destination — those stay the trip's loading/unloading).
  async function addStopFromMenu() {
    if (!menu) return
    const { candidates, zoom } = menu
    setMenu(null)
    let pos: LatLng = { lat: menu.lat, lng: menu.lng }
    let label = ''
    try {
      const { place } = await api.here.snapCandidates({ candidates, zoom })
      if (place?.position) {
        pos = place.position
        label = place.label ?? ''
      }
    } catch {
      /* snap unavailable — use the raw clicked coordinate */
    }
    setDraftStops((cur) => {
      const rt = routableStops(cur)
      const stop = mapStop(pos, label)
      if (rt.length < 2) return [...cur, stop]
      const origin = rt[0]
      const dest = rt[rt.length - 1]
      const intermediate = rt.slice(1, -1)
      // Least-detour intermediate slot, then map it to "before this waypoint" and
      // splice into the full stop array (which may interleave non-routable stops).
      const k = bestInsertionIndex(pos, origin, intermediate, dest)
      const beforeId = rt[k + 1].id
      const at = cur.findIndex((s) => s.id === beforeId)
      const next = cur.slice()
      next.splice(at < 0 ? cur.length : at, 0, stop)
      return next
    })
  }

  // Click a marker → role-aware popover (remove intermediate stops; copy any).
  function openMarkerMenu(info: { id: string; kind: RouteMarkerKind; x: number; y: number }) {
    const region = regionRef.current
    const w = region?.clientWidth ?? 0
    const h = region?.clientHeight ?? 0
    setMenu(null)
    setMarkerMenu({
      id: info.id,
      kind: info.kind,
      x: Math.min(Math.max(0, info.x + 10), Math.max(0, w - 180)),
      y: Math.min(Math.max(0, info.y), Math.max(0, h - 96)),
    })
  }

  function removeStop(id: string) {
    setMarkerMenu(null)
    setDraftStops((cur) => cur.filter((s) => s.id !== id))
  }

  async function copyStopCoord(id: string) {
    const p = routable.find((r) => r.id === id)
    setMarkerMenu(null)
    if (!p) return
    try {
      await navigator.clipboard?.writeText(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  // Dismiss the menus on Escape or an outside click.
  useEffect(() => {
    if (!menu && !markerMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setMarkerMenu(null)
      }
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (document.getElementById('trip-route-menu')?.contains(t)) return
      if (document.getElementById('trip-route-marker-menu')?.contains(t)) return
      setMenu(null)
      setMarkerMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu, markerMenu])

  function startEdit() {
    setSaveError(null)
    setDraftStops(stops)
    setEditing(true)
  }
  function cancelEdit() {
    // Discard the draft and restore the saved route.
    setEditing(false)
    setDraftStops(stops)
    setSaveError(null)
    setMenu(null)
    setMarkerMenu(null)
  }
  async function save() {
    if (!onSaveRoute) return
    setMenu(null)
    setMarkerMenu(null)
    setSaving(true)
    setSaveError(null)
    try {
      // Recompute from the final draft so the persisted route matches the saved
      // stops, and persist ONLY a real ('ok') route: a failed/incomplete recompute
      // never overwrites the previous saved route, and there's no save without
      // actual route data.
      const fresh = await computeTripRoute(draftStops)
      if (fresh.status !== 'ok') {
        setSaveError('Route unavailable for these stops — adjust a point and try again.')
        return
      }
      await onSaveRoute(draftStops, fresh)
      setEditing(false)
    } catch {
      // Keep the user in edit mode with their changes intact.
      setSaveError('Couldn’t save the route. Your changes are kept — try again.')
    } finally {
      setSaving(false)
    }
  }

  const showEditButton = canEdit && Boolean(onSaveRoute) && !editing && routable.length >= 2
  // No accidental save: needs a valid computed route AND an actual change.
  const saveDisabled = saving || !ok || !dirty

  if (routable.length < 2 && !editing) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg px-6 text-center">
        <div className="text-[0.78125rem] text-muted leading-[1.5]">
          Add coordinates to at least two stops to see the trip route.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg relative">
      <div ref={regionRef} className="flex-1 min-h-0 relative">
        <HereMap
          className="absolute inset-0"
          markers={markers}
          routePolylines={polylines}
          routeDistanceLabel={ok ? (data?.distanceText ?? null) : null}
          truckOverlay={false}
          center={center}
          // Markers/line are grabbable — and the add/remove gestures wired — only
          // while editing.
          objectsDraggable={editing}
          onMarkerDragEnd={editing ? handleMarkerDragEnd : undefined}
          onMapContextMenu={editing ? openMenu : undefined}
          onMarkerClick={editing ? openMarkerMenu : undefined}
          onMapViewChange={
            editing
              ? () => {
                  setMenu(null)
                  setMarkerMenu(null)
                }
              : undefined
          }
        />

        {/* Compact route summary overlay — distance + driving time, or a quiet
            calculating state. Gains a subtle "Editing" tag while in edit mode. */}
        <div className="absolute top-2 left-2 rounded-full bg-bg/80 backdrop-blur-sm border border-white/[0.08] px-3 py-1.5 text-[0.71875rem] flex items-center gap-2 shadow-lg">
          {editing && (
            <span className="flex items-center gap-1.5 text-active font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-active" />
              Editing
            </span>
          )}
          {editing && <span className="h-3 w-px bg-white/[0.12]" />}
          {loading && !ok ? (
            <>
              <Spinner size={13} /> <span className="text-muted">Calculating route…</span>
            </>
          ) : ok ? (
            <span className="text-text tabular-nums">
              {data?.distanceText} · {data?.durationText}
            </span>
          ) : (
            <span className="text-muted">Route unavailable — showing stops only.</span>
          )}
        </div>

        {/* Edit route — compact pill matching the map's overlay chrome. */}
        {showEditButton && (
          <button
            type="button"
            onClick={startEdit}
            className="absolute z-20 top-2 right-2 flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg/80 backdrop-blur-sm border border-white/[0.08] text-[0.71875rem] font-medium text-text hover:bg-bg transition-colors shadow-lg"
          >
            <Pencil size="0.8125rem" strokeWidth={2} />
            Edit route
          </button>
        )}

        {/* Edit-mode controls — Cancel (discard) + Save route (persist). */}
        {editing && (
          <div className="absolute z-20 top-2 right-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg/80 backdrop-blur-sm border border-white/[0.08] text-[0.71875rem] font-medium text-muted hover:text-text hover:bg-bg transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X size="0.8125rem" strokeWidth={2} />
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saveDisabled}
              title={!dirty ? 'Adjust the route first (drag, add or remove a stop)' : undefined}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-active text-bg text-[0.71875rem] font-semibold hover:bg-active/90 transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Spinner size={13} /> : <Check size="0.8125rem" strokeWidth={2.4} />}
              Save route
            </button>
          </div>
        )}

        {/* Minimal edit helper / save error — bottom-left, never covers the map. */}
        {editing && (
          <div className="absolute z-20 bottom-2 left-2 max-w-[calc(100%-1rem)]">
            {saveError ? (
              <div className="rounded-full bg-alert/15 border border-alert/25 text-alert px-3 py-1.5 text-[0.6875rem] shadow-lg">
                {saveError}
              </div>
            ) : (
              <div className="rounded-full bg-bg/80 backdrop-blur-sm border border-white/[0.08] text-muted px-3 py-1.5 text-[0.6875rem] shadow-lg">
                Drag a stop to move it · right-click to add · click a stop to remove.
              </div>
            )}
          </div>
        )}

        {/* Right-click context menu — add an intermediate stop at the click. */}
        {editing && menu && (
          <div
            id="trip-route-menu"
            className={`absolute z-30 min-w-[10rem] ${MENU_SURFACE} py-1`}
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="px-3 py-1.5 text-[0.625rem] uppercase tracking-wide text-muted border-b border-white/[0.06] mb-1">
              {menu.lat.toFixed(5)}, {menu.lng.toFixed(5)}
            </div>
            <button
              type="button"
              onClick={addStopFromMenu}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-white/[0.06] transition-colors"
            >
              <span className="text-muted">
                <MapPin size="0.875rem" strokeWidth={1.8} />
              </span>
              Add stop
            </button>
          </div>
        )}

        {/* Marker popover — copy any point; remove intermediate stops (endpoints
            are the trip's loading/unloading and are edited in the Trip tab). */}
        {editing && markerMenu && (
          <div
            id="trip-route-marker-menu"
            className={`absolute z-30 min-w-[10rem] ${MENU_SURFACE} py-1`}
            style={{ left: markerMenu.x, top: markerMenu.y }}
          >
            <div className="px-3 py-1.5 text-[0.625rem] uppercase tracking-wide text-muted border-b border-white/[0.06] mb-1">
              {markerMenu.kind === 'origin'
                ? 'Start'
                : markerMenu.kind === 'destination'
                  ? 'Destination'
                  : 'Stop'}
            </div>
            <button
              type="button"
              onClick={() => copyStopCoord(markerMenu.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-white/[0.06] transition-colors"
            >
              <span className="text-muted">
                <Copy size="0.875rem" strokeWidth={1.8} />
              </span>
              Copy coordinates
            </button>
            {markerMenu.kind === 'stop' && (
              <button
                type="button"
                onClick={() => removeStop(markerMenu.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[0.8125rem] text-alert hover:bg-alert/10 transition-colors"
              >
                <span>
                  <Trash2 size="0.875rem" strokeWidth={1.8} />
                </span>
                Remove stop
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
