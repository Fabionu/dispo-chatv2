// Per-conversation composer DRAFTS — the unsent text a user has typed but not
// yet sent. Stored CLIENT-SIDE ONLY (localStorage): never sent to the backend,
// there is no "draft" message event, column, or socket traffic. Namespaced by
// user id so drafts never leak between accounts sharing one device, and keyed by
// conversation id so each thread (DM or vehicle/group room) keeps its own.
//
// Storage key: `dispo:drafts:{userId}:{conversationId}`.
//
// Same persistence shape as lib/messageDisplay.ts — localStorage is the single
// source of truth, with same-tab listeners + the cross-tab `storage` event so
// the sidebar draft preview updates live as the composer writes.

import { useEffect, useState } from 'react'

const PREFIX = 'dispo:drafts'

// Full storage key for one conversation's draft.
function draftKey(userId: string, conversationId: string): string {
  return `${PREFIX}:${userId}:${conversationId}`
}

// Same-tab subscribers, notified synchronously on every write so open sidebar
// rows re-read immediately (the cross-tab `storage` event covers other tabs).
// A conversationId of '*' means "many/all drafts changed" (e.g. a sign-out
// clear), so every subscriber for that user should re-read.
type Listener = (userId: string, conversationId: string) => void
const listeners = new Set<Listener>()

export function getDraft(userId: string, conversationId: string): string {
  if (!userId || !conversationId) return ''
  try {
    return localStorage.getItem(draftKey(userId, conversationId)) ?? ''
  } catch {
    return ''
  }
}

// Persist (or, for empty text, remove) a conversation's draft, then notify
// same-tab subscribers. Empty text is stored as "no draft" so an emptied
// composer clears the sidebar preview and leaves no stray key behind.
export function setDraft(userId: string, conversationId: string, text: string): void {
  if (!userId || !conversationId) return
  try {
    if (text) localStorage.setItem(draftKey(userId, conversationId), text)
    else localStorage.removeItem(draftKey(userId, conversationId))
  } catch {
    /* ignore quota / unavailability — the in-memory notify still updates this tab */
  }
  listeners.forEach((fn) => fn(userId, conversationId))
}

export function clearDraft(userId: string, conversationId: string): void {
  setDraft(userId, conversationId, '')
}

// Drop EVERY draft belonging to a user — called on sign-out so drafts don't
// linger on a shared device after the account is gone.
export function clearUserDrafts(userId: string): void {
  if (!userId) return
  try {
    const prefix = `${PREFIX}:${userId}:`
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(userId, '*'))
}

export function subscribeDrafts(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// React hook: the live draft text for one conversation, for the sidebar preview.
// Re-reads on same-tab writes (listener set) and cross-tab writes (`storage`).
export function useDraft(userId: string, conversationId: string): string {
  const [draft, setDraftState] = useState(() => getDraft(userId, conversationId))
  useEffect(() => {
    // Reconcile any value that changed between render and effect setup.
    setDraftState(getDraft(userId, conversationId))
    const onChange = (u: string, c: string) => {
      if (u === userId && (c === conversationId || c === '*')) {
        setDraftState(getDraft(userId, conversationId))
      }
    }
    const unsub = subscribeDrafts(onChange)
    const onStorage = (e: StorageEvent) => {
      // key === null → storage cleared wholesale; otherwise match our exact key.
      if (e.key === null || e.key === draftKey(userId, conversationId)) {
        setDraftState(getDraft(userId, conversationId))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsub()
      window.removeEventListener('storage', onStorage)
    }
  }, [userId, conversationId])
  return draft
}
