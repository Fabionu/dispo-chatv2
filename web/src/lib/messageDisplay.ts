// Message DISPLAY STYLE — a user preference for how the message timeline is
// rendered. Independent of both the auto width-based `density` and the
// sidebar `viewMode` (compact/normal):
//   - 'bubble' (DEFAULT): the classic chat bubbles (mine right, others left).
//   - 'plain': a no-bubble grouped "operational log" stream — plain text rows
//     grouped by author, timestamps on hover, lighter and easier to scan.
//
// Persisted in localStorage and reflected as a `data-msg-style` attribute on
// <html> (same mechanism as density/viewMode) so message rows react live when
// the user switches. Defaults to 'bubble' so nothing changes until opted in —
// the plain stream is a reversible experiment, never a forced replacement.

import { useEffect, useState } from 'react'

export type MessageDisplay = 'bubble' | 'plain'

const STORAGE_KEY = 'dispo:msg-style'

function isMessageDisplay(v: unknown): v is MessageDisplay {
  return v === 'bubble' || v === 'plain'
}

export function getStoredMessageDisplay(): MessageDisplay | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isMessageDisplay(v) ? v : null
  } catch {
    return null
  }
}

function apply(m: MessageDisplay) {
  document.documentElement.dataset.msgStyle = m
}

// Set (and persist) the message display style. Applies immediately so every
// mounted message row re-renders in the new style.
export function setMessageDisplay(m: MessageDisplay) {
  try {
    localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* ignore quota/availability — the attribute still applies this session */
  }
  apply(m)
}

// React hook: the live message display style. Reads the attribute this module
// writes on <html> and re-renders when it changes. Defaults to 'bubble'.
export function useMessageDisplay(): MessageDisplay {
  const [m, setM] = useState<MessageDisplay>(() => {
    if (typeof document === 'undefined') return 'bubble'
    const v = document.documentElement.dataset.msgStyle
    return isMessageDisplay(v) ? v : (getStoredMessageDisplay() ?? 'bubble')
  })
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => {
      const v = el.dataset.msgStyle
      if (isMessageDisplay(v)) setM(v)
    })
    obs.observe(el, { attributes: true, attributeFilter: ['data-msg-style'] })
    return () => obs.disconnect()
  }, [])
  return m
}

// Call once at startup (before React renders) so the attribute is present on the
// first paint — no flash. Applies the stored choice, else the 'bubble' default.
export function initMessageDisplay() {
  if (typeof window === 'undefined') return
  apply(getStoredMessageDisplay() ?? 'bubble')
}
