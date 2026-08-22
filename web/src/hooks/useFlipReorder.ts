import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// ── FLIP animation for a list that reorders under the cursor ────────────────
// A live drag-to-reorder list teleports: one frame a row is in the old slot,
// the next it is in the new one, and the eye gets nothing to follow — which row
// moved, and where did the one it displaced go? FLIP answers both without
// animating layout (which would fight the drag): the list still lays itself out
// instantly, then every row that changed slot is transformed BACK to where it
// was drawn and released, so the browser interpolates the gap on the compositor.
//
//   containerRef  goes on the element wrapping the rows.
//   data-flip-key must be on every row, carrying its stable identity — that is
//                 what tells "row 2 slid down" apart from "row 2 was replaced".
//   capture()     is called SYNCHRONOUSLY before the state change that reorders
//                 the list, while the DOM still shows the old order.
//
// Rows the snapshot doesn't know (just mounted) and rows that didn't move are
// left alone, so inserting or removing one row doesn't drag every neighbour
// through an animation it never needed.
//
// Interruptions are the normal case here, not an edge case: a drag crosses rows
// faster than any animation finishes. `capture()` therefore records where each
// row is DRAWN — mid-flight transform included — so the next animation picks up
// from what the user can actually see instead of snapping back to the settled
// slot first. Animations run through the Web Animations API rather than CSS
// transitions so they leave no inline styles behind for the next reorder (or a
// row's own hover transitions) to trip over.
//
// `isSettling(key)` exists because animating a list that reorders on hover moves
// the hit test out from under the truth: for as long as a row is sliding, the
// browser targets it where it is DRAWN rather than where it now belongs, so a
// hover reads the slot the row just left and asks for the swap back — the list
// then bounces between two orders for the length of the drag. Callers ask before
// acting on a hover, and a row in flight simply doesn't answer until it lands.

const FLIP_ATTR = 'data-flip-key'

const rowsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(`[${FLIP_ATTR}]`))

// Reduced motion is an accessibility setting, not a preference to interpolate:
// when it is on, the list keeps teleporting (instant is exactly what it asks
// for) and nothing here runs.
const canAnimate = () =>
  typeof window !== 'undefined' &&
  typeof Element.prototype.animate === 'function' &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useFlipReorder<E extends HTMLElement = HTMLDivElement>({
  duration = 180,
  easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)',
}: { duration?: number; easing?: string } = {}) {
  const containerRef = useRef<E | null>(null)
  // key → distance from the container's top edge at capture time. Measured
  // against the CONTAINER rather than the viewport so a list that scrolls
  // between the capture and the commit (drag auto-scroll does exactly that near
  // a scroll region's edges) can't smear every delta by the scrolled amount.
  const before = useRef<Map<string, number> | null>(null)
  // The in-flight animations THIS hook started, by row key — so an interrupting
  // reorder can call off precisely those (leaving a row's own CSS transitions
  // running), and so a caller can ask whether a given row has landed yet.
  const playing = useRef(new Map<string, Animation>())

  const capture = useCallback(() => {
    const container = containerRef.current
    if (!container || !canAnimate()) return
    const top = container.getBoundingClientRect().top
    const snapshot = new Map<string, number>()
    for (const row of rowsIn(container)) {
      const key = row.getAttribute(FLIP_ATTR)
      if (key) snapshot.set(key, row.getBoundingClientRect().top - top)
    }
    before.current = snapshot
  }, [])

  // Runs after every commit but does something only when a capture is pending —
  // i.e. on the render that the captured reorder produced. Layout effects fire
  // after the DOM is mutated and before paint, which is the one moment where the
  // rows can be moved back without the new order ever reaching the screen.
  useLayoutEffect(() => {
    const snapshot = before.current
    before.current = null
    const container = containerRef.current
    if (!snapshot || !container) return

    const rows = rowsIn(container)
    // Cancel, then measure, then animate — in three passes. An animation
    // outranks inline styles in the cascade, so a row still in flight has to be
    // released before its settled position can be read at all; keeping the reads
    // and writes in separate passes also costs one layout flush instead of one
    // per row. Every pending animation is superseded by this reorder, and the
    // snapshot already holds the position each row was drawn at, so cancelling
    // wholesale can't make anything jump.
    playing.current.forEach((animation) => animation.cancel())
    playing.current.clear()
    const top = container.getBoundingClientRect().top
    const moves: Array<[HTMLElement, string, number]> = []
    for (const row of rows) {
      const key = row.getAttribute(FLIP_ATTR)
      const from = key ? snapshot.get(key) : undefined
      if (!key || from === undefined) continue
      const delta = from - (row.getBoundingClientRect().top - top)
      // Sub-pixel drift isn't movement; animating it would only add jitter.
      if (Math.abs(delta) >= 0.5) moves.push([row, key, delta])
    }
    for (const [row, key, delta] of moves) {
      const animation = row.animate(
        [{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration, easing },
      )
      playing.current.set(key, animation)
      // `finished` rejects on cancel; the guard keeps a newer animation for the
      // same row from being dropped out of the map by an older one settling.
      const done = () => {
        if (playing.current.get(key) === animation) playing.current.delete(key)
      }
      animation.finished.then(done, done)
    }
  })

  // Is this row still sliding into its new slot? Reads a ref, so it is always
  // current inside an event handler.
  const isSettling = useCallback((key: string) => playing.current.has(key), [])

  const animations = playing.current
  useEffect(
    () => () => {
      animations.forEach((animation) => animation.cancel())
      animations.clear()
    },
    [animations],
  )

  return { containerRef, capture, isSettling }
}
