import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import type { ScheduledMessage } from '../lib/types'

// The signed-in user's own undelivered messages for one conversation, kept live.
//
// Scheduled messages are sender-private: the server only ever RETURNS the
// caller's own rows, and only ever emits `scheduled-message:changed` into the
// author's personal room — so subscribing here can't surface another member's
// queue. The event carries no payload worth trusting beyond its groupId, so a
// matching one just triggers a refetch.
//
// The worker emits both `message:new` (to the room) and a 'sent' change (to the
// author) when an item goes out, so the faded pending bubble disappears in the
// same beat the real message lands.
export function useScheduledMessages(groupId: string | null): {
  scheduled: ScheduledMessage[]
  cancel: (id: string) => Promise<void>
} {
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([])

  const reload = useCallback(async () => {
    if (!groupId) return
    try {
      const result = await api.groups.scheduledMessages(groupId)
      setScheduled(result.scheduledMessages)
    } catch {
      // Leave the last known queue on screen. This is ambient chrome beside the
      // conversation — a failed poll must not blank it or raise an error.
    }
  }, [groupId])

  // Drop a queued message before it sends. Optimistic: the bubble is ambient
  // chrome beside the conversation, so removing it on the spot reads better
  // than a spinner on a row that is about to vanish. A failure reloads, which
  // puts it back. The server also emits a 'deleted' change, so other surfaces
  // showing the same queue (the Schedule dialog) converge on their own.
  const cancel = useCallback(
    async (id: string) => {
      if (!groupId) return
      setScheduled((items) => items.filter((item) => item.id !== id))
      try {
        await api.groups.deleteScheduledMessage(groupId, id)
      } catch {
        void reload()
      }
    },
    [groupId, reload],
  )

  useEffect(() => {
    // Drop the previous conversation's queue immediately, so switching rooms
    // can never flash the wrong pending bubble while the refetch is in flight.
    setScheduled([])
    if (!groupId) return

    void reload()
    const socket = getSocket()
    const onChanged = (event: { groupId?: string }) => {
      if (event.groupId === groupId) void reload()
    }
    socket.on('scheduled-message:changed', onChanged)
    return () => {
      socket.off('scheduled-message:changed', onChanged)
    }
  }, [groupId, reload])

  return { scheduled, cancel }
}
