// Display density: manual choices use the exact token sets in index.css. Auto
// only selects a broad tier for numeric React props (avatars, logos, etc.); its
// layout and visual sizing are CSS-first and follow logical viewport/container
// dimensions.
//
// Do not multiply the viewport by devicePixelRatio here. Browser CSS pixels
// already account for Windows/macOS display scaling, and applying DPR again was
// what made the UI change dramatically between 100% and 150% OS scaling.

import { useEffect, useState } from 'react'

export type Density = 'compact' | 'default' | 'comfortable'

// Design-px to rem. Size-prop components keep a numeric API while following
// the root scale selected in CSS.
export const rem = (px: number): string => `${px / 16}rem`

export const SIDEBAR_AVATAR_SIZE: Record<Density, number> = {
  compact: 32,
  default: 34,
  comfortable: 36,
}

export const SIDEBAR_CONVERSATION_AVATAR_SIZE: Record<Density, number> = {
  compact: 38,
  default: 40,
  comfortable: 42,
}

const STORAGE_KEY = 'dispo:density'

// Logical CSS-pixel breakpoints. A 2560px display at 150% scaling exposes
// roughly 1707 CSS px and therefore receives the same standard Auto treatment
// as a 1920px display at 100% scaling.
const COMFORTABLE_MQ = '(min-width: 2200px) and (min-height: 1100px)'
const COMPACT_MQ = '(max-width: 1280px)'

// Clear inline variables written by the previous interpolated Auto system
// during HMR or an in-place upgrade. New Auto sizing lives in index.css.
const LEGACY_AUTO_PROPERTIES = [
  '--ui-scale',
  '--app-font-size',
  '--chat-msg-font-size',
  '--header-height',
  '--sidebar-width',
  '--composer-size',
  '--chat-max-width',
  '--chat-gutter',
  '--sidebar-title-font-size',
  '--sidebar-row-font-size',
  '--sidebar-meta-font-size',
  '--sidebar-section-font-size',
  '--sidebar-icon-size',
  '--sidebar-user-avatar-size',
  '--sidebar-search-height',
  '--sidebar-row-height',
  '--sidebar-badge-size',
  '--sidebar-row-gap',
  '--sidebar-row-pad-x',
  '--sidebar-row-pad-y',
  '--sidebar-section-gap',
]

function clearLegacyAutoSizing() {
  const style = document.documentElement.style
  for (const property of LEGACY_AUTO_PROPERTIES) style.removeProperty(property)
}

function isDensity(value: unknown): value is Density {
  return value === 'compact' || value === 'default' || value === 'comfortable'
}

// Tier implied by the logical viewport, ignoring any manual override. CSS does
// the finer responsive work; this tier keeps numeric React sizes in sync.
export function autoDensity(): Density {
  if (typeof window === 'undefined') return 'default'
  if (window.innerWidth >= 2200 && window.innerHeight >= 1100) return 'comfortable'
  if (window.innerWidth <= 1280) return 'compact'
  return 'default'
}

export function getStoredDensity(): Density | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isDensity(value) ? value : null
  } catch {
    return null
  }
}

type DensityMode = 'auto' | 'manual'

function apply(density: Density, mode: DensityMode) {
  const root = document.documentElement
  root.dataset.density = density
  root.dataset.densityMode = mode
  clearLegacyAutoSizing()
}

// Pin an exact manual appearance. Manual CSS tokens remain unchanged.
export function setDensity(density: Density) {
  try {
    localStorage.setItem(STORAGE_KEY, density)
  } catch {
    // The current document can still apply the choice when storage is blocked.
  }
  apply(density, 'manual')
}

// Drop the manual override and return to logical-viewport Auto.
export function clearDensityOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore unavailable storage; the current document can still switch.
  }
  apply(autoDensity(), 'auto')
}

// React hook for components whose numeric size props depend on the active tier.
export function useDensity(): Density {
  const [density, setCurrentDensity] = useState<Density>(() => {
    if (typeof document === 'undefined') return 'default'
    const value = document.documentElement.dataset.density
    return isDensity(value) ? value : autoDensity()
  })

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const value = root.dataset.density
      if (isDensity(value)) setCurrentDensity(value)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-density'] })
    return () => observer.disconnect()
  }, [])

  return density
}

// Call once before React renders. Stored manual choices win; otherwise Auto
// follows logical viewport threshold changes and lets CSS handle fluid sizing.
export function initDensity() {
  if (typeof window === 'undefined') return

  const stored = getStoredDensity()
  apply(stored ?? autoDensity(), stored ? 'manual' : 'auto')

  const reapply = () => {
    if (!getStoredDensity()) apply(autoDensity(), 'auto')
  }

  window.matchMedia(COMFORTABLE_MQ).addEventListener('change', reapply)
  window.matchMedia(COMPACT_MQ).addEventListener('change', reapply)
  window.addEventListener('resize', reapply)
  window.visualViewport?.addEventListener('resize', reapply)
}
