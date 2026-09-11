import { useRef, useState } from 'react'
import type { MapSurfaceProps, MapViewport } from './mapProps'
import GoogleMap from './GoogleMap'

// The map the app draws on. Google's, always.
//
// Until 2026-09-11 this switched engines on the HGV toggle: the truck
// restriction view was HERE's `vector.normal.logistics` BASEMAP, so asking
// for restrictions meant swapping Google's map for HERE's (`HereMap`). It
// worked, and it read as broken — the map changed style instead of gaining
// something, and the user's reference was the apps that draw restrictions
// OVER Google's map. The restrictions are now a tile layer on the Google map
// (GoogleMap + hgvOverlay.ts), so there is one engine and nothing to swap.
// `HereMap` is no longer imported anywhere; it stays in the tree for its
// drag/snap/hover machinery, which GoogleMap's was ported from.
//
// The viewport bookkeeping below is what the swap used to need — the last
// view of the outgoing engine handed to the incoming one. With one engine it
// only forwards `onViewportChange`; kept as the one place a future second
// engine would plug in.
export default function MapView(props: MapSurfaceProps) {
  const lastViewRef = useRef<MapViewport | null>(props.initialView ?? null)
  const [handoff] = useState<MapViewport | null>(props.initialView ?? null)

  const shared: MapSurfaceProps = {
    ...props,
    initialView: handoff,
    onViewportChange: (view) => {
      lastViewRef.current = view
      props.onViewportChange?.(view)
    },
  }

  return <GoogleMap key="google" {...shared} />
}
