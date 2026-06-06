import { useEffect, useState } from 'react'
import { MapPin, Navigation, X } from 'lucide-react'
import { api, ApiError, type VehiclePosition } from '../../lib/api'
import MapView from './MapView'
import Spinner from '../Spinner'

type Props = {
  groupId: string
  groupName: string
  onClose: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; location: VehiclePosition }
  | { kind: 'empty' }
  | { kind: 'not_configured' }
  | { kind: 'error' }

// Themed modal showing a vehicle group's latest known position on an Amazon
// Location map. Foundation only: one fetch, one marker, centered on the latest
// point. Live updates / history come later. Lazy-loaded by ChatView so MapLibre
// stays out of the main bundle.
export default function VehicleLocationModal({ groupId, groupName, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    api.groups
      .location(groupId)
      .then((r) => {
        if (cancelled) return
        setState(r.location ? { kind: 'ready', location: r.location } : { kind: 'empty' })
      })
      .catch((e) => {
        if (cancelled) return
        setState(
          e instanceof ApiError && e.code === 'location_not_configured'
            ? { kind: 'not_configured' }
            : { kind: 'error' },
        )
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  // Esc closes (matches the app's other overlays).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const loc = state.kind === 'ready' ? state.location : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Vehicle location"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[760px] max-h-[86vh] flex flex-col rounded-[11px] border border-white/[0.08] bg-rail overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        {/* Header */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 border-b border-white/[0.06] shrink-0">
          <div className="min-w-0 flex items-center gap-2">
            <MapPin size={16} strokeWidth={1.8} className="text-active shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{groupName}</div>
              <div className="text-[11px] text-muted leading-tight">Vehicle location</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* Map / states — fixed-height area */}
        <div className="relative flex-1 min-h-[420px]">
          {state.kind === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-rail">
              <Spinner variant="lg" />
            </div>
          )}

          {state.kind === 'ready' && loc && (
            <MapView
              className="absolute inset-0"
              center={{ lat: loc.latitude, lng: loc.longitude }}
              marker={{ lat: loc.latitude, lng: loc.longitude }}
              zoom={13}
            />
          )}

          {state.kind === 'empty' && (
            <EmptyLike
              icon={<Navigation size={26} strokeWidth={1.5} className="text-faint" />}
              title="No location received yet"
              hint="This vehicle hasn't reported a position. It'll appear here once the tracker sends one."
            />
          )}

          {state.kind === 'not_configured' && (
            <EmptyLike
              icon={<MapPin size={26} strokeWidth={1.5} className="text-faint" />}
              title="Location isn't set up"
              hint="Vehicle tracking hasn't been configured for this workspace yet."
            />
          )}

          {state.kind === 'error' && (
            <EmptyLike
              icon={<MapPin size={26} strokeWidth={1.5} className="text-alert" />}
              title="Could not load location"
              hint="Something went wrong fetching the latest position. Try again shortly."
            />
          )}
        </div>

        {/* Footer meta (only when we have a fix). */}
        {loc && (
          <div className="shrink-0 border-t border-white/[0.06] px-4 py-2.5 flex items-center justify-between gap-3 text-[11px] text-muted">
            <span className="truncate">
              {loc.timestamp ? `Updated ${new Date(loc.timestamp).toLocaleString()}` : 'Time unknown'}
            </span>
            <span className="shrink-0 font-mono text-faint">
              {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
              {loc.accuracy != null ? ` · ±${Math.round(loc.accuracy)}m` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyLike({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rail text-center px-8">
      {icon}
      <div className="text-[13px] font-medium text-text">{title}</div>
      <div className="text-[11.5px] text-faint max-w-[320px] leading-[1.5]">{hint}</div>
    </div>
  )
}
