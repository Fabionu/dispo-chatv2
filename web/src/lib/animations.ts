// Animation preferences. Same persistence shape as lib/theme.ts and
// lib/messageStyle.ts — localStorage plus a root data attribute, applied before
// the first paint so nothing runs an entrance the user has switched off.
//
// TWO settings, deliberately separate, because they answer different questions:
//
//   data-animations   UNIVERSAL. Whether the interface's entrances run at all —
//                     the modal and panel fade-ins, the action strips, the
//                     typing row, the attach menu. One switch for "does this
//                     app move".
//   data-composer-fx  LOCAL, and a CHOICE rather than a switch: which effect
//                     the composer plays as you type. `ink` fades each new
//                     character in (the mirror layer — see the note in
//                     ChatComposer), `pulse` runs a line out from the middle of
//                     the composer's border to both edges on each keystroke,
//                     `none` leaves the field still.
//
// The universal switch OUTRANKS the composer choice: with animations off the
// composer is still, whichever effect is selected. That is what makes the first
// setting mean what it says, and it means a user who wants a quiet app sets one
// thing rather than two. The composer's stored choice is kept, not cleared, so
// turning animations back on restores it.
//
// prefers-reduced-motion is NOT folded into these. It stays its own block in
// index.css, so an OS-level preference is honoured before this module's JS has
// run and regardless of what is stored here — a setting can turn motion OFF but
// must never turn it back ON against the system.

import { useEffect, useState } from 'react'

export type InterfaceAnimations = 'on' | 'off'
export type ComposerEffect = 'ink' | 'pulse' | 'none'

const ANIMATIONS_KEY = 'dispo:animations-v1'
const COMPOSER_FX_KEY = 'dispo:composer-fx-v1'

// Motion on, and the composer's ink fade, are what the app shipped with — a new
// device sees the design as drawn.
const ANIMATIONS_FALLBACK: InterfaceAnimations = 'on'
const COMPOSER_FX_FALLBACK: ComposerEffect = 'ink'

function isAnimations(value: unknown): value is InterfaceAnimations {
  return value === 'on' || value === 'off'
}

function isComposerEffect(value: unknown): value is ComposerEffect {
  return value === 'ink' || value === 'pulse' || value === 'none'
}

export function getStoredAnimations(): InterfaceAnimations {
  try {
    const value = localStorage.getItem(ANIMATIONS_KEY)
    return isAnimations(value) ? value : ANIMATIONS_FALLBACK
  } catch {
    return ANIMATIONS_FALLBACK
  }
}

export function getStoredComposerEffect(): ComposerEffect {
  try {
    const value = localStorage.getItem(COMPOSER_FX_KEY)
    return isComposerEffect(value) ? value : COMPOSER_FX_FALLBACK
  } catch {
    return COMPOSER_FX_FALLBACK
  }
}

function applyAnimations(value: InterfaceAnimations) {
  document.documentElement.dataset.animations = value
}

function applyComposerEffect(value: ComposerEffect) {
  document.documentElement.dataset.composerFx = value
}

export function setAnimations(value: InterfaceAnimations) {
  try {
    localStorage.setItem(ANIMATIONS_KEY, value)
  } catch {
    /* ignore storage failures — the live setting still applies */
  }
  applyAnimations(value)
}

export function setComposerEffect(value: ComposerEffect) {
  try {
    localStorage.setItem(COMPOSER_FX_KEY, value)
  } catch {
    /* ignore storage failures — the live setting still applies */
  }
  applyComposerEffect(value)
}

export function initAnimations() {
  if (typeof document === 'undefined') return
  applyAnimations(getStoredAnimations())
  applyComposerEffect(getStoredComposerEffect())
}

// One subscription helper for both attributes. Settings surfaces use it so a
// change made anywhere is reflected everywhere; the composer uses it because
// which effect it plays decides what DOM it renders (the ink mirror is a real
// element), which is the one thing CSS cannot decide on its own.
function useRootAttribute<T>(
  attribute: 'animations' | 'composerFx',
  filter: string,
  guard: (value: unknown) => value is T,
  read: () => T,
): T {
  const [value, setValue] = useState<T>(() => {
    if (typeof document === 'undefined') return read()
    const current = document.documentElement.dataset[attribute]
    return guard(current) ? current : read()
  })

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const current = root.dataset[attribute]
      if (guard(current)) setValue(current)
    })
    observer.observe(root, { attributes: true, attributeFilter: [filter] })
    return () => observer.disconnect()
  }, [attribute, filter, guard])

  return value
}

export function useAnimations(): InterfaceAnimations {
  return useRootAttribute('animations', 'data-animations', isAnimations, getStoredAnimations)
}

export function useComposerEffect(): ComposerEffect {
  return useRootAttribute('composerFx', 'data-composer-fx', isComposerEffect, getStoredComposerEffect)
}

/**
 * The composer effect that is actually LIVE — the stored choice, silenced when
 * interface animations are off. The composer asks for this rather than the raw
 * choice so the universal switch cannot be defeated by a local one.
 */
export function useActiveComposerEffect(): ComposerEffect {
  const effect = useComposerEffect()
  const animations = useAnimations()
  return animations === 'off' ? 'none' : effect
}
