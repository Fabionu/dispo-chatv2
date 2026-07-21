import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ConnectionsResponse } from '../lib/types'
import { getSocket } from '../lib/socket'

const EMPTY_CONNECTIONS: ConnectionsResponse = {
  accepted: [],
  pendingReceived: [],
  pendingSent: [],
}

// Cross-workspace connections state extracted from Workspace: load once, then
// refetch whenever a connection lifecycle event fires. Refetching (rather than
// patching) keeps the three buckets consistent. On failure we keep whatever
// buckets we already had so the rail doesn't blank out; `error` drives the
// section's compact retryable error state instead.
export function useConnections() {
  const [connections, setConnections] = useState<ConnectionsResponse>(EMPTY_CONNECTIONS)
  const [connectionsError, setConnectionsError] = useState(false)

  const refreshConnections = useCallback(async () => {
    setConnectionsError(false)
    try {
      setConnections(await api.connections.list())
    } catch {
      setConnectionsError(true)
    }
  }, [])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  useEffect(() => {
    const socket = getSocket()
    const onChange = () => void refreshConnections()
    socket.on('connection:requested', onChange)
    socket.on('connection:accepted', onChange)
    socket.on('connection:declined', onChange)
    socket.io.on('reconnect', onChange)
    return () => {
      socket.off('connection:requested', onChange)
      socket.off('connection:accepted', onChange)
      socket.off('connection:declined', onChange)
      socket.io.off('reconnect', onChange)
    }
  }, [refreshConnections])

  return { connections, connectionsError, refreshConnections }
}
