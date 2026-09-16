// Bits of the route's presentation that both map engines share verbatim: the
// mid-route badge's DOM, and the one question every route animation asks
// before it moves.

/**
 * Fill `el` with the route badge — the distance, and the time after it when
 * the caller has one ("1164 km · 27 h 33 min") — and say whether there was
 * anything to show. The element is the engine's (a HERE DomIcon's child or a
 * Google OverlayView's), positioned by the engine; only its contents are
 * built here so the two badges cannot drift. Styles: index.css
 * `.route-distance-badge` (the time half is `.route-distance-badge-time`).
 */
export function renderRouteBadge(
  el: HTMLElement,
  distance: string | null | undefined,
  time?: string | null,
): boolean {
  el.textContent = ''
  if (!distance) return false
  el.append(distance)
  if (time) {
    const t = document.createElement('span')
    t.className = 'route-distance-badge-time'
    t.textContent = time
    el.append(t)
  }
  return true
}

/**
 * Whether the route may animate at all — read at call time, not once at module
 * load: the user can flip either setting while the planner is open, and a
 * stale answer would keep animating at them.
 *
 * Two conditions, both of which must allow it (see lib/animations.ts for why
 * they are kept separate): the OS-level prefers-reduced-motion, and the app's
 * own Appearance → Animations switch (`data-animations` on the root). A setting
 * can turn motion off; nothing here turns it on against the system.
 */
export function routeMotionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  return document.documentElement.dataset.animations !== 'off'
}
