import { io, type Socket } from 'socket.io-client'

// Single shared Socket.IO connection for the whole app. Connecting to the
// same origin (no URL arg) means the session cookie rides along on the
// handshake automatically — the server reads it for auth. In dev, Vite
// proxies /socket.io to the API on :3001.
//
// Socket.IO handles reconnection itself (exponential backoff, capped). We
// don't tear the socket down on route changes — it lives for the session.

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      // Prefer a real WebSocket; fall back to polling only if it's blocked.
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
