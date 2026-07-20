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

// Design-px → rem string. The whole app is sized in rem so the root font-size
// (16px × --ui-scale: 16px normally, 18px on `comfortable`, 19px on 4K — see
// index.css) scales it uniformly on 2K+ displays. Size-prop components (Avatar,
// GroupAvatar, CompanyLogo, AppMark, Spinner, DocIcon) keep their numeric px
// API but render through this, so a `size={28}` is ~26.25px at 1080p and
// ~29.75px on the comfortable tier.
export const rem = (px: number): string => `${px / 16}rem`

// Sidebar avatar / company-logo diameter per tier, in DESIGN px (pre-rem-scale
// — Avatar/CompanyLogo render size/16 rem, so the comfortable root bump adds
// its ×1.0625 on top: 36 → ~38.25 actual, matching the tuned
// --sidebar-user-avatar-size token in index.css). Components that take a
// numeric `size` can't read the CSS density tokens, so they read this map via
// useDensity() instead.
//
// These stay slightly larger than each tier's row text block so identity remains
// readable at a glance; rail rows wrap the avatar in IdentitySlot (zero-height
// flex slot) so the extra diameter centres into the row's existing padding
// instead of growing the row.
export const SIDEBAR_AVATAR_SIZE: Record<Density, number> = {
  compact: 32,
  default: 34,
  comfortable: 36,
}

// Conversation identities get more visual weight than utility/header avatars.
// GroupRow renders both direct messages and vehicle groups through the same
// zero-height IdentitySlot, so these larger sizes do not change row padding or
// row height. Kept explicit per appearance tier so the progression is stable.
export const SIDEBAR_CONVERSATION_AVATAR_SIZE: Record<Density, number> = {
  compact: 38,
  default: 40,
  comfortable: 42,
}

const STORAGE_KEY = 'dispo:density'
// 2K/QHD (2560-wide) and up → comfortable. Below 1536 → compact (laptops).
// In between → default (1080p desktops). The height gate keeps 2560×1080-class
// ultrawides (1080p-height displays) on the default tier. Ultra-wide/4K
// (≥3000px) is NOT a fourth tier — it's a pure-CSS refinement layered on
// comfortable in index.css (--ui-scale 1.125 + bumped px tokens); keep this
// MQ in sync with index.css's fallbacks.
const COMFORTABLE_MQ = '(min-width: 2200px) and (min-height: 1200px)'
const COMPACT_MQ = '(max-width: 1535px)'

type AutoProfile = {
  at: number
  uiScale: number
  tokens: Record<string, number>
}

// Calibrated anchor points for common physical display classes. Auto blends
// continuously between them, so 1600p, ultrawide, scaled-QHD, and other in-
// between displays no longer inherit the nearest preset wholesale.
const AUTO_PROFILES: AutoProfile[] = [
  {
    at: 1366 / 1920,
    uiScale: 0.875,
    tokens: {
      '--app-font-size': 13,
      '--chat-msg-font-size': 13.5,
      '--header-height': 52,
      '--sidebar-width': 440,
      '--composer-size': 30,
      '--chat-max-width': 900,
      '--chat-gutter': 14,
      '--sidebar-title-font-size': 15.5,
      '--sidebar-row-font-size': 13.5,
      '--sidebar-meta-font-size': 11.5,
      '--sidebar-section-font-size': 10,
      '--sidebar-icon-size': 18,
      '--sidebar-user-avatar-size': 28,
      '--sidebar-search-height': 34,
      '--sidebar-row-height': 38,
      '--sidebar-badge-size': 18,
      '--sidebar-row-gap': 9,
      '--sidebar-row-pad-x': 10,
      '--sidebar-row-pad-y': 7,
      '--sidebar-section-gap': 22,
    },
  },
  {
    at: 1,
    uiScale: 0.9375,
    tokens: {
      '--app-font-size': 14,
      '--chat-msg-font-size': 14.5,
      '--header-height': 56,
      '--sidebar-width': 560,
      '--composer-size': 32,
      '--chat-max-width': 960,
      '--chat-gutter': 16,
      '--sidebar-title-font-size': 16,
      '--sidebar-row-font-size': 14,
      '--sidebar-meta-font-size': 12,
      '--sidebar-section-font-size': 10.5,
      '--sidebar-icon-size': 19,
      '--sidebar-user-avatar-size': 32,
      '--sidebar-search-height': 36,
      '--sidebar-row-height': 40,
      '--sidebar-badge-size': 19,
      '--sidebar-row-gap': 10,
      '--sidebar-row-pad-x': 11,
      '--sidebar-row-pad-y': 8,
      '--sidebar-section-gap': 24,
    },
  },
  {
    at: 2560 / 1920,
    uiScale: 1.1875,
    tokens: {
      '--app-font-size': 17,
      '--chat-msg-font-size': 18.5,
      '--header-height': 72,
      '--sidebar-width': 600,
      '--composer-size': 40,
      '--chat-max-width': 1040,
      '--chat-gutter': 24,
      '--sidebar-title-font-size': 19,
      '--sidebar-row-font-size': 17,
      '--sidebar-meta-font-size': 14.5,
      '--sidebar-section-font-size': 12,
      '--sidebar-icon-size': 24,
      '--sidebar-user-avatar-size': 42,
      '--sidebar-search-height': 46,
      '--sidebar-row-height': 52,
      '--sidebar-badge-size': 23,
      '--sidebar-row-gap': 13,
      '--sidebar-row-pad-x': 14,
      '--sidebar-row-pad-y': 10,
      '--sidebar-section-gap': 30,
    },
  },
  {
    at: 2,
    uiScale: 1.25,
    tokens: {
      '--app-font-size': 18,
      '--chat-msg-font-size': 19.5,
      '--header-height': 76,
      '--sidebar-width': 640,
      '--composer-size': 42,
      '--chat-max-width': 1120,
      '--chat-gutter': 26,
      '--sidebar-title-font-size': 20,
      '--sidebar-row-font-size': 18,
      '--sidebar-meta-font-size': 15.5,
      '--sidebar-section-font-size': 12.5,
      '--sidebar-icon-size': 25,
      '--sidebar-user-avatar-size': 45,
      '--sidebar-search-height': 49,
      '--sidebar-row-height': 55,
      '--sidebar-badge-size': 24,
      '--sidebar-row-gap': 14,
      '--sidebar-row-pad-x': 15,
      '--sidebar-row-pad-y': 11,
      '--sidebar-section-gap': 32,
    },
  },
]

const AUTO_PROPERTIES = ['--ui-scale', ...Object.keys(AUTO_PROFILES[0].tokens)]

function effectiveViewport() {
  const displayScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5)
  return {
    width: window.innerWidth * displayScale,
    height: window.innerHeight * displayScale,
  }
}

function autoRatio() {
  const viewport = effectiveViewport()
  // The limiting axis wins: a wide-but-short ultrawide should not receive a
  // 4K-sized UI just because it has many horizontal pixels.
  return Math.min(viewport.width / 1920, viewport.height / 1080)
}

function applyAutoSizing() {
  const ratio = autoRatio()
  const last = AUTO_PROFILES[AUTO_PROFILES.length - 1]
  const upperIndex = AUTO_PROFILES.findIndex((profile) => profile.at >= ratio)
  const upper = upperIndex === -1 ? last : AUTO_PROFILES[upperIndex]
  const lower =
    upperIndex <= 0 ? AUTO_PROFILES[0] : AUTO_PROFILES[Math.min(upperIndex - 1, AUTO_PROFILES.length - 1)]
  const span = upper.at - lower.at
  const progress = span <= 0 ? 0 : Math.min(Math.max((ratio - lower.at) / span, 0), 1)
  const interpolate = (from: number, to: number) => from + (to - from) * progress
  const root = document.documentElement

  root.style.setProperty('--ui-scale', String(interpolate(lower.uiScale, upper.uiScale)))
  for (const property of Object.keys(lower.tokens)) {
    root.style.setProperty(
      property,
      `${interpolate(lower.tokens[property], upper.tokens[property]).toFixed(3)}px`,
    )
  }
}

function clearAutoSizing() {
  const style = document.documentElement.style
  for (const property of AUTO_PROPERTIES) style.removeProperty(property)
}

function isDensity(v: unknown): v is Density {
  return v === 'compact' || v === 'default' || v === 'comfortable'
}

// The tier the current viewport implies, ignoring any manual override.
export function autoDensity(): Density {
  if (typeof window === 'undefined') return 'default'
  // Windows display scaling changes the CSS viewport (for example, QHD at
  // 125% reports roughly 2048x1152). Multiplying by DPR recovers the effective
  // display resolution so Auto matches the dimensions chosen manually for that
  // monitor. Cap the multiplier so Retina/high-DPI screens with deliberately
  // small logical workspaces are not forced into an oversized layout.
  const viewport = effectiveViewport()
  if (viewport.width >= 2200 && viewport.height >= 1200) return 'comfortable'
  if (viewport.width <= 1535) return 'compact'
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

type DensityMode = 'auto' | 'manual'

function apply(d: Density, mode: DensityMode) {
  document.documentElement.dataset.density = d
  // Keep the source of the density visible to CSS. Auto may use the same text /
  // control tier as a manual choice while still applying viewport-aware layout
  // refinements such as a wider desktop sidebar.
  document.documentElement.dataset.densityMode = mode
  if (mode === 'auto') applyAutoSizing()
  else clearAutoSizing()
}

// Manually pin a density (persisted). Wins over auto-selection.
export function setDensity(d: Density) {
  try {
    localStorage.setItem(STORAGE_KEY, d)
  } catch {
    /* ignore quota/availability issues — the attribute still applies */
  }
  apply(d, 'manual')
}

// Drop the manual override and return to width-based auto-selection.
export function clearDensityOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  apply(autoDensity(), 'auto')
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
  apply(stored ?? autoDensity(), stored ? 'manual' : 'auto')
  // Always arm the auto-follow listeners: reapply() re-checks for an override
  // on every fire, so they stand down while one exists — and take over again
  // if the override is cleared later (Workspace settings → Appearance → Auto)
  // without needing a reload.
  const reapply = () => {
    if (!getStoredDensity()) apply(autoDensity(), 'auto')
  }
  window.matchMedia(COMFORTABLE_MQ).addEventListener('change', reapply)
  window.matchMedia(COMPACT_MQ).addEventListener('change', reapply)
  window.addEventListener('resize', reapply)
  window.visualViewport?.addEventListener('resize', reapply)
}
