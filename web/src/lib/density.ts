// Display density: discrete UI-scale tiers applied via a `data-density`
// attribute on <html>. The actual sizes live in CSS variables (see index.css);
// this module only decides WHICH tier is active and writes the attribute.
//
// Tiers are auto-selected from viewport width so a 2K/QHD monitor gets the
// roomier `comfortable` scale while 1080p keeps the tuned `default`. A manual
// choice (future settings UI) is persisted in localStorage and always wins; the
// auto-follow listener stands down once an override exists.

import { useEffect, useState } from 'react'

export type Density = 'compact' | 'default' | 'comfortable'

// Sidebar avatar / company-logo diameter per tier. Components that take a
// numeric `size` (Avatar, CompanyLogo) can't read the CSS density tokens, so
// they read this map via useDensity() instead. Kept in lockstep with the
// --sidebar-user-avatar-size token in index.css.
export const SIDEBAR_AVATAR_SIZE: Record<Density, number> = {
  compact: 34,
  default: 36,
  comfortable: 43,
}

const STORAGE_KEY = 'dispo:density'
// 2K/QHD (2560-wide) and up → comfortable. Below 1536 → compact (laptops).
// In between → default (1080p desktops).
const COMFORTABLE_MQ = '(min-width: 2200px)'
const COMPACT_MQ = '(max-width: 1535px)'

function isDensity(v: unknown): v is Density {
  return v === 'compact' || v === 'default' || v === 'comfortable'
}

// The tier the current viewport implies, ignoring any manual override.
export function autoDensity(): Density {
  if (typeof window === 'undefined') return 'default'
  if (window.matchMedia(COMFORTABLE_MQ).matches) return 'comfortable'
  if (window.matchMedia(COMPACT_MQ).matches) return 'compact'
  return 'default'
}

export function getStoredDensity(): Density | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isDensity(v) ? v : null
  } catch {
    return null
  }
}

function apply(d: Density) {
  document.documentElement.dataset.density = d
}

// Manually pin a density (persisted). Wins over auto-selection.
export function setDensity(d: Density) {
  try {
    localStorage.setItem(STORAGE_KEY, d)
  } catch {
    /* ignore quota/availability issues — the attribute still applies */
  }
  apply(d)
}

// Drop the manual override and return to width-based auto-selection.
export function clearDensityOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  apply(autoDensity())
}

// React hook: the live density tier. Reads the attribute lib/density.ts writes
// on <html> and re-renders when it changes (viewport crosses a tier boundary,
// or a manual override is set), so size-prop components track density too.
export function useDensity(): Density {
  const [d, setD] = useState<Density>(() => {
    if (typeof document === 'undefined') return 'default'
    const v = document.documentElement.dataset.density
    return isDensity(v) ? v : autoDensity()
  })
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => {
      const v = el.dataset.density
      if (isDensity(v)) setD(v)
    })
    obs.observe(el, { attributes: true, attributeFilter: ['data-density'] })
    return () => obs.disconnect()
  }, [])
  return d
}

// Call once at startup (before React renders) so the attribute is present on
// the first paint — no flash. Applies the stored override if any, else the
// auto tier, and keeps following the viewport while no override is set.
export function initDensity() {
  if (typeof window === 'undefined') return
  const stored = getStoredDensity()
  apply(stored ?? autoDensity())
  if (stored) return
  const reapply = () => {
    if (!getStoredDensity()) apply(autoDensity())
  }
  window.matchMedia(COMFORTABLE_MQ).addEventListener('change', reapply)
  window.matchMedia(COMPACT_MQ).addEventListener('change', reapply)
}
