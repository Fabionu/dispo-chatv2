// Message DISPLAY STYLE — how the chat timeline renders each message:
//   - 'bubble' (DEFAULT): minimal rounded-rectangle bubbles, mine right /
//     others left, subtle grey skins on the dark chat surface.
//   - 'plain': the no-bubble grouped "operational log" stream.
//
// Reintroduced 2026-07-03 as a real preference (it was briefly retired with
// 'plain' forced). Same persistence model as lib/density.ts — localStorage is
// the single source of truth, mirrored onto <html data-msg-style> for
// first-paint parity, with same-tab listeners + the cross-tab `storage` event
// so every MessageRow updates live when the setting changes.
//
// STORAGE_KEY is deliberately NEW (`-v2`): during the retirement window the
// old key was force-overwritten to 'plain' on every startup, so it no longer
// reflects a real user choice. Ignoring (and clearing) it lets bubbles be the
// default for everyone again; anyone who prefers the stream just re-picks it
// in Workspace settings → Appearance.

import { useEffect, useState } from 'react'

export type MessageDisplay = 'bubble' | 'plain'

const STORAGE_KEY = 'dispo:msg-style-v2'
const LEGACY_KEY = 'dispo:msg-style'

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

// The effective style: the saved choice, else the 'bubble' default. Reading
// straight from storage keeps consumers correct regardless of init order.
function currentMessageDisplay(): MessageDisplay {
  return getStoredMessageDisplay() ?? 'bubble'
}

// Mirror onto <html data-msg-style> for first-paint parity / styling hooks.
// NOT the source of truth.
function apply(m: MessageDisplay) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.msgStyle = m
}

// Same-tab live subscribers — setMessageDisplay notifies synchronously so the
// settings control and every visible MessageRow update immediately.
const listeners = new Set<() => void>()

// Set (and persist) the style. Persists first, then applies + notifies.
export function setMessageDisplay(m: MessageDisplay) {
  try {
    localStorage.setItem(STORAGE_KEY, m)
  } catch {
    /* ignore quota/availability — the in-memory notify still applies this session */
  }
  apply(m)
  listeners.forEach((fn) => fn())
}

// React hook: the live style. Syncs with same-tab changes (listener set) and
// other tabs/windows (`storage` event).
export function useMessageDisplay(): MessageDisplay {
  const [m, setM] = useState<MessageDisplay>(currentMessageDisplay)
  useEffect(() => {
    const sync = () => setM(currentMessageDisplay())
    listeners.add(sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) sync()
    }
    window.addEventListener('storage', onStorage)
    // Reconcile any change between the initial render and effect setup.
    sync()
    return () => {
      listeners.delete(sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return m
}

// Call once at startup (before React renders) so the attribute is present on
// the first paint. Also drops the force-written legacy key (see header note).
export function initMessageDisplay() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* ignore */
  }
  apply(currentMessageDisplay())
}
