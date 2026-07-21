import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline'

function currentStatus(): ConnectionStatus {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'
  return getSocket().connected ? 'connected' : 'reconnecting'
}

// One small source of truth for transport health. Socket.IO already performs
// exponential-backoff reconnects; this hook exposes that lifecycle to the UI
// and restarts a socket that the server explicitly disconnected.
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(currentStatus)

  useEffect(() => {
    const socket = getSocket()
    const connected = () => setStatus('connected')
    const reconnecting = () =>
      setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting')
    const offline = () => setStatus('offline')
    const online = () => {
      if (!socket.connected) socket.connect()
      setStatus(socket.connected ? 'connected' : 'reconnecting')
    }
    const disconnected = (reason: string) => {
      reconnecting()
      // Socket.IO does not automatically reconnect after an explicit server
      // disconnect. The workspace is session-scoped, so retry while it exists.
      if (reason === 'io server disconnect') socket.connect()
    }

    socket.on('connect', connected)
    socket.on('disconnect', disconnected)
    socket.on('connect_error', reconnecting)
    socket.io.on('reconnect_attempt', reconnecting)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)

    setStatus(currentStatus())
    return () => {
      socket.off('connect', connected)
      socket.off('disconnect', disconnected)
      socket.off('connect_error', reconnecting)
      socket.io.off('reconnect_attempt', reconnecting)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [])

  return status
}
