import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import type { LocalMessage } from '../components/messages/types'

// Owns the group's pinned-messages bar for one open conversation: loads the pins
// on open, then keeps them in sync with live pin / unpin / delete socket events.
// Held separately from the thread cache so a pin older than the loaded page still
// shows. Returns the list plus its setter, since the optimistic pin/unpin
// handlers in ChatView still drive it directly.
export function usePinnedMessages(
  groupId: string,
): [LocalMessage[], Dispatch<SetStateAction<LocalMessage[]>>] {
  const [pinned, setPinned] = useState<LocalMessage[]>([])

  useEffect(() => {
    let cancelled = false
    api.groups
      .pins(groupId)
      .then((res) => {
        if (!cancelled) setPinned(res.messages as LocalMessage[])
      })
      .catch(() => {})

    const socket = getSocket()
    function onPinned(p: { groupId: string; message: LocalMessage }) {
      if (p.groupId !== groupId) return
      // Replace if already present, else prepend (newest pin first).
      setPinned((prev) => [p.message, ...prev.filter((m) => m.id !== p.message.id)])
    }
    function onUnpinned(p: { groupId: string; id: string }) {
      if (p.groupId !== groupId) return
      setPinned((prev) => prev.filter((m) => m.id !== p.id))
    }
    function onDeleted(p: { groupId: string; id: string }) {
      if (p.groupId !== groupId) return
      setPinned((prev) => prev.filter((m) => m.id !== p.id))
    }
    socket.on('message:pinned', onPinned)
    socket.on('message:unpinned', onUnpinned)
    socket.on('message:deleted', onDeleted)
    return () => {
      cancelled = true
      socket.off('message:pinned', onPinned)
      socket.off('message:unpinned', onUnpinned)
      socket.off('message:deleted', onDeleted)
    }
  }, [groupId])

  return [pinned, setPinned]
}
