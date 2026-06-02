import { useCallback, useEffect, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

// Live online/offline presence for the current user's peers, driven by the
// server's `presence:snapshot` (current state) and `presence:update` (deltas).
//
// Returns the set of online user ids AND a `resync()` to re-request a snapshot.
// The snapshot the server sends is scoped to the caller's *co-members* (people
// who share a group/DM). That set changes when a connection is accepted or a
// new DM is created — and a peer who was ALREADY online at that moment never
// emits a transition (`presence:update`), so the only way to learn they're
// online is to ask for a fresh snapshot. Callers therefore resync whenever the
// group list changes (see Workspace), not just on connect. The snapshot is held
// in this hook's own state, independent of whether the UI has loaded groups yet,
// so an early snapshot is never lost.
export function usePresence(): { online: Set<string>; resync: () => void } {
  const [online, setOnline] = useState<Set<string>>(new Set())
  // Keep a stable ref to the live socket so `resync` doesn't change identity
  // (it's used as an effect dependency in consumers).
  const socketRef = useRef(getSocket())

  const resync = useCallback(() => {
    socketRef.current.emit('presence:sync')
  }, [])

  useEffect(() => {
    const socket = socketRef.current

    function onSnapshot(p: { online: string[] }) {
      setOnline(new Set(p.online))
    }
    function onUpdate(p: { userId: string; online: boolean }) {
      setOnline((prev) => {
        if (prev.has(p.userId) === p.online) return prev
        const next = new Set(prev)
        if (p.online) next.add(p.userId)
        else next.delete(p.userId)
        return next
      })
    }

    socket.on('presence:snapshot', onSnapshot)
    socket.on('presence:update', onUpdate)
    // Resync on every (re)connect — the connect-time snapshot may have arrived
    // before this listener was attached.
    socket.on('connect', resync)
    // Ask now in case we're already connected (listener attached post-connect).
    resync()

    return () => {
      socket.off('presence:snapshot', onSnapshot)
      socket.off('presence:update', onUpdate)
      socket.off('connect', resync)
    }
  }, [resync])

  return { online, resync }
}
