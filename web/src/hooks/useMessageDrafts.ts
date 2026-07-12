import { useCallback, useEffect, useRef } from 'react'
import { clearDraft, setDraft } from '../lib/draftStorage'

// How long to wait after the last keystroke before persisting the draft, so we
// write at most once per pause instead of on every character.
const WRITE_DEBOUNCE_MS = 400

// Persist a conversation's composer text as a DRAFT (see lib/draftStorage). Owns
// only the WRITE side: a debounced save while typing, an immediate flush when the
// conversation unmounts (so switching away never drops the last keystrokes the
// debounce hadn't written yet), and a `clearDraft` for a successful send.
//
// `enabled` gates writes — the caller passes `false` while EDITING an existing
// message, so an in-progress edit (which temporarily reuses the composer text) is
// never mistaken for a draft.
export function useMessageDrafts({
  userId,
  conversationId,
  text,
  enabled = true,
}: {
  userId: string
  conversationId: string
  text: string
  enabled?: boolean
}): { clearDraft: () => void } {
  const timer = useRef<number | undefined>(undefined)
  // Latest values captured for the unmount flush — that effect must not re-run
  // per keystroke, so it can't close over `text` / `enabled` directly.
  const latestText = useRef(text)
  latestText.current = text
  const latestEnabled = useRef(enabled)
  latestEnabled.current = enabled

  // Debounced persist while typing. Skipped (and any pending write cancelled)
  // while disabled, so editing never writes a draft.
  useEffect(() => {
    if (!enabled) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setDraft(userId, conversationId, latestText.current)
    }, WRITE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer.current)
  }, [userId, conversationId, text, enabled])

  // Flush the latest text on unmount / conversation change so switching away
  // (which unmounts this ChatView, keyed by group id) persists the draft
  // synchronously rather than losing an in-flight debounce.
  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current)
      if (latestEnabled.current) setDraft(userId, conversationId, latestText.current)
    }
  }, [userId, conversationId])

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    clearDraft(userId, conversationId)
  }, [userId, conversationId])

  return { clearDraft: clear }
}
