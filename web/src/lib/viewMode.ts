// Conversation VIEW MODE — a user-chosen preference distinct from the auto
// width-based display `density` (see lib/density.ts). It controls how rich the
// conversation rows / identity slots are:
//   - 'compact' (DEFAULT): the original dense sidebar — a small type glyph per
//     row, tight rows, no avatar preview. The established look.
//   - 'normal': a larger conversation-identity slot (DM avatar / generated
//     vehicle icon) with room for future message previews + more breathing room.
//
// PERSISTENCE MODEL — localStorage is the SINGLE SOURCE OF TRUTH. Every consumer
// derives its value from the stored key, so the saved choice always wins and can
// never be shadowed by a stale DOM attribute or a late default. We still mirror
// the mode onto `<html data-view>` for first-paint parity (same mechanism as
// density), but nothing READS the attribute to decide the mode — that removes the
// race where the attribute could lag the saved value. We default to 'compact' on
// purpose: the richer layout is opt-in, never forced over a saved choice.

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

// The effective mode: the saved choice, else the 'compact' default. Reading
// straight from storage means a consumer is correct even if initViewMode() never
// ran (e.g. an earlier startup step threw) — there is no reliance on init order.
function currentViewMode(): ViewMode {
  return getStoredViewMode() ?? 'compact'
}

// Mirror onto <html data-view> for first-paint parity / styling hooks. Kept in
// lockstep with the stored value, but it is NOT the source of truth.
function apply(m: ViewMode) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.view = m
}

// Same-tab live subscribers. setViewMode notifies them synchronously so every
// useViewMode() consumer (the settings control + every sidebar row) updates
// immediately — a direct channel, no MutationObserver round-trip.
const listeners = new Set<() => void>()

// Set (and persist) the view mode. Persists first, then applies + notifies so all
// consumers re-render against the saved value.
export function setViewMode(m: ViewMode) {
  try {
    localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* ignore quota/availability — the in-memory notify still applies this session */
  }
  apply(m)
  listeners.forEach((fn) => fn())
}

// React hook: the live view mode. Initialises from the stored value and stays in
// sync with both same-tab changes (the listener set) and OTHER tabs/windows (the
// `storage` event) — so a choice made in one window is reflected everywhere
// without a refresh, and a refresh always restores the saved value.
export function useViewMode(): ViewMode {
  const [m, setM] = useState<ViewMode>(currentViewMode)
  useEffect(() => {
    const sync = () => setM(currentViewMode())
    listeners.add(sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) sync()
    }
    window.addEventListener('storage', onStorage)
    // Reconcile any change that happened between the initial render and now.
    sync()
    return () => {
      listeners.delete(sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return m
}

// Call once at startup (before React renders) so the attribute is present on the
// first paint — no flash. Applies the stored choice, else the 'compact' default.
export function initViewMode() {
  if (typeof window === 'undefined') return
  apply(currentViewMode())
}
