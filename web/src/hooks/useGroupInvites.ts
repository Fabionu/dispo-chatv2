import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { GroupInvite } from '../lib/types'
import { getSocket } from '../lib/socket'

// Pending vehicle-group invitations extracted from Workspace: load once, then
// refetch on any invite lifecycle event. Refetching keeps the pending list
// authoritative (same approach as connections). On accept, the server also
// emits `group:added`, so the group itself appears via the groups socket sync.
export function useGroupInvites() {
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([])

  const refreshGroupInvites = useCallback(async () => {
    const { invites } = await api.groupInvites.list()
    setGroupInvites(invites)
  }, [])

  useEffect(() => {
    void refreshGroupInvites()
  }, [refreshGroupInvites])

  useEffect(() => {
    const socket = getSocket()
    const onChange = () => void refreshGroupInvites()
    socket.on('group_invite:created', onChange)
    socket.on('group_invite:accepted', onChange)
    socket.on('group_invite:declined', onChange)
    socket.on('group_invite:cancelled', onChange)
    socket.io.on('reconnect', onChange)
    return () => {
      socket.off('group_invite:created', onChange)
      socket.off('group_invite:accepted', onChange)
      socket.off('group_invite:declined', onChange)
      socket.off('group_invite:cancelled', onChange)
      socket.io.off('reconnect', onChange)
    }
  }, [refreshGroupInvites])

  return { groupInvites, refreshGroupInvites }
}
