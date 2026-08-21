import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// ── The travelling marker ───────────────────────────────────────────────────
// One selection idiom, four surfaces: the Group Info tab pill, the rail's filter
// bar, the Settings segmented control, and the bar down the selected
// conversation. In each the mark is a SINGLE element that measures wherever the
// live item is and slides there — never one mark per item fading in and out.
//
// That distinction is the whole point. A per-item mark makes selection read as
// "this one lit up and that one went dark"; one mark that MOVES reads as the
// same object travelling, which is what tells you the two options belong to one
// control. It is also cheaper: moving one absolutely-positioned element lays out
// nothing, whereas toggling a border or a background on two rows invalidates
// both of them.
//
// This hook was extracted when the third and fourth copies were about to be
// written. The first two (FilterTabBar, PanelTabs) had already drifted — one
// re-measured after the webfont loaded and the other did not, so the same
// mechanism was subtly wrong in one of the two places.
//
// Positions are measured with getBoundingClientRect DELTAS rather than
// `offsetLeft`/`offsetTop`, and that is a bug fix, not a preference. `offset*`
// is relative to the nearest POSITIONED ancestor, which is not necessarily the
// track: a conversation row wraps its button in a `relative` div (it anchors the
// row's action strip), so every row reported `offsetTop ≈ 0` and the bar sat at
// the top of the list and never moved. Two viewport-relative rects subtracted
// are immune to whatever is positioned in between — and to scrolling, since both
// are read in the same frame and move together.
//
// The track still needs `relative`, because the MARKER is absolutely positioned
// against it. It just no longer has to be the measured element's offsetParent.

export type MarkerRect = { x: number; y: number; w: number; h: number }

export function useTravellingMarker(
  /**
   * Anything that changes when the marker must re-measure. The live item's key
   * is the obvious one, but a caller whose ITEMS move without the track
   * resizing (a reordered list) has to fold that into this value too — a
   * ResizeObserver on the track cannot see a reorder that keeps the same
   * height. Deciding that belongs at the call site, which is the only place
   * that knows what can move.
   */
  activeKey: unknown,
  /** How to find the live item inside the track. */
  selector = '[aria-current="true"]',
): { trackRef: (node: HTMLElement | null) => void; rect: MarkerRect | null } {
  const trackEl = useRef<HTMLElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [rect, setRect] = useState<MarkerRect | null>(null)

  const measure = useCallback(() => {
    const track = trackEl.current
    if (!track) return
    const active = track.querySelector<HTMLElement>(selector)
    // No live item — the selection was filtered out of the list, or nothing is
    // selected at all. The caller renders no marker rather than a stale one.
    if (!active) {
      setRect(null)
      return
    }
    const trackBox = track.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    // getBoundingClientRect is the BORDER box, but the marker is positioned
    // absolutely inside the track, and `left: 0` there resolves to the track's
    // PADDING box. Subtracting the track's own border keeps the two frames the
    // same. It is zero on all four tracks today; it is here so that giving one
    // of them a border later does not silently shift its marker.
    const style = getComputedStyle(track)
    const borderL = parseFloat(style.borderLeftWidth) || 0
    const borderT = parseFloat(style.borderTopWidth) || 0
    const next = {
      x: activeBox.left - trackBox.left - borderL,
      y: activeBox.top - trackBox.top - borderT,
      w: activeBox.width,
      h: activeBox.height,
    }
    // Same-value bail: a ResizeObserver fires for plenty of resizes that do not
    // move the marker, and setting an equal-but-new object would re-render every
    // one of them. Compared with an epsilon rather than `===` because these are
    // fractional now — subpixel noise is not movement.
    setRect((prev) =>
      prev &&
      Math.abs(prev.x - next.x) < 0.5 &&
      Math.abs(prev.y - next.y) < 0.5 &&
      Math.abs(prev.w - next.w) < 0.5 &&
      Math.abs(prev.h - next.h) < 0.5
        ? prev
        : next,
    )
  }, [selector])

  useLayoutEffect(measure, [measure, activeKey])

  // The track is the offsetParent, so ITS resize — the rail widening, labels
  // reflowing, rows entering or leaving — is what moves the items. The callback
  // ref owns the observer's whole life: React calls it with `null` on unmount,
  // and a separate cleanup effect would be run once by StrictMode and leave the
  // observer dead for the rest of the session.
  const trackRef = useCallback(
    (node: HTMLElement | null) => {
      roRef.current?.disconnect()
      roRef.current = null
      trackEl.current = node
      if (!node) return
      const ro = new ResizeObserver(measure)
      ro.observe(node)
      roRef.current = ro
    },
    [measure],
  )

  // Labels are mono and the mono face loads late, so the widths measured on the
  // first pass can be the fallback font's. Re-measure once it lands. This was
  // FilterTabBar's fix and PanelTabs never got it; it belongs to the mechanism,
  // not to one of its users.
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (live) measure()
    })
    return () => {
      live = false
    }
  }, [measure])

  return { trackRef, rect }
}
