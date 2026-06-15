// Conversation VIEW MODE — a user-chosen preference distinct from the auto
// width-based display `density` (see lib/density.ts). It controls how rich the
// conversation rows / identity slots are:
//   - 'compact' (DEFAULT): the original dense sidebar — a small type glyph per
//     row, tight rows, no avatar preview. The established look.
//   - 'normal': a larger conversation-identity slot (DM avatar / generated
//     vehicle icon) with room for future message previews + more breathing room.
//
// Persisted in localStorage and reflected as a `data-view` attribute on <html>
// (same mechanism as density) so a hook can react live when the user switches.
// We default to 'compact' on purpose: the richer layout is opt-in, never forced.

import { useEffect, useState } from 'react'

export type ViewMode = 'compact' | 'normal'

const STORAGE_KEY = 'dispo:view-mode'

function isViewMode(v: unknown): v is ViewMode {
  return v === 'compact' || v === 'normal'
}

export function getStoredViewMode(): ViewMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isViewMode(v) ? v : null
  } catch {
    return null
  }
}

function apply(m: ViewMode) {
  document.documentElement.dataset.view = m
}

// Set (and persist) the view mode. Applies immediately so all `useViewMode`
// consumers re-render.
export function setViewMode(m: ViewMode) {
  try {
    localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* ignore quota/availability — the attribute still applies for this session */
  }
  apply(m)
}

// React hook: the live view mode. Reads the attribute this module writes on
// <html> and re-renders when it changes (a manual switch), so size/shape-prop
// components track it. Defaults to 'compact'.
export function useViewMode(): ViewMode {
  const [m, setM] = useState<ViewMode>(() => {
    if (typeof document === 'undefined') return 'compact'
    const v = document.documentElement.dataset.view
    return isViewMode(v) ? v : (getStoredViewMode() ?? 'compact')
  })
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => {
      const v = el.dataset.view
      if (isViewMode(v)) setM(v)
    })
    obs.observe(el, { attributes: true, attributeFilter: ['data-view'] })
    return () => obs.disconnect()
  }, [])
  return m
}

// Call once at startup (before React renders) so the attribute is present on the
// first paint — no flash. Applies the stored choice, else the 'compact' default.
export function initViewMode() {
  if (typeof window === 'undefined') return
  apply(getStoredViewMode() ?? 'compact')
}
