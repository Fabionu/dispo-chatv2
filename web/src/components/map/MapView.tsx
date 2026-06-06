import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPinned, TriangleAlert } from 'lucide-react'
import { mapStyleUrl } from '../../lib/mapConfig'
import Spinner from '../Spinner'

export type LatLng = { lat: number; lng: number }

type Props = {
  // Where to center the map. Null → a neutral world view (e.g. no data yet).
  center: LatLng | null
  zoom?: number
  // A single marker to drop (the vehicle). Null → no marker.
  marker?: (LatLng & { label?: string }) | null
  className?: string
}

// Reusable Amazon Location (MapLibre GL) map. Owns the GL instance lifecycle and
// surfaces themed loading / error / not-configured states. Keep it presentational
// — callers pass center/marker; data fetching lives elsewhere. Lazy-load this
// module (and its callers) so MapLibre stays out of the main bundle.
export default function MapView({ center, zoom = 12, marker, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const styleUrl = mapStyleUrl()

  // Initialise the map once. styleUrl is derived from build-time env, so it's
  // stable for the component's life.
  useEffect(() => {
    if (!styleUrl || !containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: center ? [center.lng, center.lat] : [0, 20],
      zoom: center ? zoom : 1,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setStatus('ready'))
    map.on('error', () => setStatus('error'))
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Init-only; center/marker are applied in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl])

  // Recenter when the target changes (e.g. a fresh position arrives).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.jumpTo({ center: [center.lng, center.lat], zoom })
  }, [center, zoom])

  // Keep a single marker in sync with the prop.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (marker) {
      if (!markerRef.current) markerRef.current = new maplibregl.Marker({ color: '#c89572' })
      markerRef.current.setLngLat([marker.lng, marker.lat]).addTo(map)
    } else if (markerRef.current) {
      markerRef.current.remove()
    }
  }, [marker])

  // Not configured: themed message instead of a broken map.
  if (!styleUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-rail text-center px-6 ${className ?? ''}`}
      >
        <MapPinned size={26} strokeWidth={1.5} className="text-faint" />
        <div className="text-[12.5px] text-muted">Map is not configured.</div>
        <div className="text-[11px] text-faint max-w-[260px]">
          Set the Amazon Location map env values to enable the map.
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-rail ${className ?? ''}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-rail/60 backdrop-blur-[1px]">
          <Spinner variant="lg" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rail text-center px-6">
          <TriangleAlert size={24} strokeWidth={1.6} className="text-alert" />
          <div className="text-[12.5px] text-muted">Could not load the map.</div>
        </div>
      )}
    </div>
  )
}
