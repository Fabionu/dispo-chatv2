import { lazy, Suspense, useRef, useState } from 'react'
import type { MapSurfaceProps, MapViewport } from './mapProps'
import GoogleMap from './GoogleMap'

// HereMap is the heavier engine (its own SDK, WebGL, the HERE key round-trip)
// and now the one most sessions never open — only an HGV toggle reaches it. So
// it loads on demand, and the planner's first paint is Google's map alone.
const HereMap = lazy(() => import('../here/HereMap'))

// Which basemap draws the route.
//
// THE RULE IS ONE LINE: the HGV overlay is on → HERE; otherwise → Google.
// Google's map is the familiar one and the default (user, 2026-09-11). The HGV
// overlay — truck restrictions drawn into the map — is a HERE BASEMAP
// (`vector.normal.logistics`), not a layer that can be laid over someone else's
// tiles, so the moment it is asked for, the whole map has to be HERE's. The
// toggle the planner already had is therefore also the engine switch, and the
// route, markers, places and gestures are identical on both because both draw
// the same contract (mapProps.ts).
//
// The viewport is handed across the swap. Without it, every toggle would land
// on the default view or re-fit the route, and a dispatcher zoomed in on a
// junction to check a restriction would lose the junction the instant they
// asked for the restriction.
export default function MapView(props: MapSurfaceProps) {
  const engine = props.truckOverlay ? 'here' : 'google'
  // The latest view of whichever engine is live. Held in a ref AND mirrored
  // to state: the ref is what the outgoing engine writes as its camera moves,
  // the state is what the incoming engine is constructed with.
  const lastViewRef = useRef<MapViewport | null>(props.initialView ?? null)
  const [handoff, setHandoff] = useState<MapViewport | null>(props.initialView ?? null)
  // The "adjust state on a prop change" idiom: the previous engine is STATE,
  // so the comparison survives React's re-render of this same pass (a ref
  // mutated in the first pass would already match by the second).
  const [prevEngine, setPrevEngine] = useState(engine)
  if (prevEngine !== engine) {
    setPrevEngine(engine)
    setHandoff(lastViewRef.current)
  }

  const shared: MapSurfaceProps = {
    ...props,
    initialView: handoff,
    onViewportChange: (view) => {
      lastViewRef.current = view
      props.onViewportChange?.(view)
    },
  }

  if (engine === 'here') {
    return (
      <Suspense fallback={<div className={props.className} />}>
        <HereMap key="here" {...shared} />
      </Suspense>
    )
  }
  return <GoogleMap key="google" {...shared} />
}
