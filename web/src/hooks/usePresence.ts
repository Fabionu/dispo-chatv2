import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'

// Live online/offline presence for the current user's peers, driven by the
// server's `presence:snapshot` (current state) and `presence:update` (deltas).
// Returns the set of user ids currently online. We request a fresh snapshot on
// mount and on every (re)connect, since the connect-time snapshot may arrive
// before this listener is attached.
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    const socket = getSocket()

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
    function sync() {
      socket.emit('presence:sync')
    }

    socket.on('presence:snapshot', onSnapshot)
    socket.on('presence:update', onUpdate)
    socket.on('connect', sync)
    // Ask now in case we're already connected (listener attached post-connect).
    sync()

    return () => {
      socket.off('presence:snapshot', onSnapshot)
      socket.off('presence:update', onUpdate)
      socket.off('connect', sync)
    }
  }, [])

  return online
}
