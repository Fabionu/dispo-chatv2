import { useEffect, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'
import type { TypingUser } from '../components/messages/TypingIndicator'

// Typing indicator cadence. We re-announce "still typing" at most once per
// THROTTLE while keys are flowing, send a stop after STOP_IDLE of silence, and
// each receiver auto-expires a typer after TTL as a backstop if a stop is lost.
const TYPING_THROTTLE_MS = 2500
const TYPING_STOP_IDLE_MS = 3000
const TYPING_TTL_MS = 6000

// Owns the whole typing-indicator feature for one open conversation: emits
// typing:start/stop as the composer `text` changes (outbound), and tracks who
// else is typing via the `typing` socket event (inbound). Returns the list of
// other users currently typing, for the TypingIndicator UI.
//
// Extracted verbatim from ChatView — same throttle/idle/TTL cadence and the same
// cleanup on group switch / unmount.
export function useTypingIndicator(
  groupId: string,
  currentUserId: string,
  text: string,
): TypingUser[] {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  // Typing-emission bookkeeping (outbound).
  const typingActiveRef = useRef(false)
  const typingSentAtRef = useRef(0)
  const typingStopTimer = useRef<number | undefined>(undefined)
  // Per-typer auto-expiry timers (inbound).
  const typingExpiry = useRef<Record<string, number>>({})

  // ── Typing indicator: emit (outbound) ──────────────────────────────────
  // Driven by the composer text we own. Announce "typing" at most once per
  // throttle window while keys flow; schedule a "stop" after a short idle.
  useEffect(() => {
    const socket = getSocket()
    const sendStop = () => {
      window.clearTimeout(typingStopTimer.current)
      if (typingActiveRef.current) {
        typingActiveRef.current = false
        socket.emit('typing:stop', { groupId })
      }
    }
    if (text.trim().length === 0) {
      sendStop()
      return
    }
    const now = Date.now()
    if (!typingActiveRef.current || now - typingSentAtRef.current > TYPING_THROTTLE_MS) {
      typingActiveRef.current = true
      typingSentAtRef.current = now
      socket.emit('typing:start', { groupId })
    }
    window.clearTimeout(typingStopTimer.current)
    typingStopTimer.current = window.setTimeout(sendStop, TYPING_STOP_IDLE_MS)
  }, [text, groupId])

  // Make sure we tell the room we stopped when leaving the conversation.
  useEffect(
    () => () => {
      window.clearTimeout(typingStopTimer.current)
      if (typingActiveRef.current) {
        typingActiveRef.current = false
        getSocket().emit('typing:stop', { groupId })
      }
    },
    [groupId],
  )

  // ── Typing indicator: receive (inbound) ────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    const expiry = typingExpiry.current
    const remove = (id: string) => {
      window.clearTimeout(expiry[id])
      delete expiry[id]
      setTypingUsers((prev) => prev.filter((u) => u.id !== id))
    }
    function onTyping(p: {
      groupId: string
      userId: string
      name?: string
      typing: boolean
    }) {
      if (p.groupId !== groupId || p.userId === currentUserId) return
      if (!p.typing) return remove(p.userId)
      // Refresh the auto-expiry backstop in case a stop event is dropped.
      window.clearTimeout(expiry[p.userId])
      expiry[p.userId] = window.setTimeout(() => remove(p.userId), TYPING_TTL_MS)
      setTypingUsers((prev) => {
        const name = p.name || 'Someone'
        const existing = prev.find((u) => u.id === p.userId)
        if (existing) {
          return existing.name === name
            ? prev
            : prev.map((u) => (u.id === p.userId ? { ...u, name } : u))
        }
        return [...prev, { id: p.userId, name }]
      })
    }
    socket.on('typing', onTyping)
    return () => {
      socket.off('typing', onTyping)
      for (const id of Object.keys(expiry)) window.clearTimeout(expiry[id])
      typingExpiry.current = {}
      setTypingUsers([])
    }
  }, [groupId, currentUserId])

  return typingUsers
}
