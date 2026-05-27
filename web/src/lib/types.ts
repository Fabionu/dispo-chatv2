// Shared shapes for data crossing the API boundary. Kept in one place so the
// fetch helpers, socket events, and components all agree.

export type GroupType = 'vehicle' | 'direct'

export type DirectPeer = {
  id: string
  name: string | null
  workspace: string | null
}

export type Group = {
  id: string
  type: GroupType
  name: string | null
  description: string | null
  meta: { plate?: string; trip?: string } & Record<string, unknown>
  lastMessageAt: string | null
  lastReadAt: string | null
  createdAt: string
  memberCount: number
  directPeer: DirectPeer | null
}

// A group's display label depends on its type: vehicle groups carry a name,
// direct groups are labelled by the other participant.
export function groupLabel(g: Group): string {
  if (g.type === 'direct') return g.directPeer?.name ?? 'Direct message'
  return g.name ?? 'Untitled group'
}

export function groupHasUnread(g: Group): boolean {
  if (!g.lastMessageAt) return false
  if (!g.lastReadAt) return true
  return new Date(g.lastMessageAt) > new Date(g.lastReadAt)
}

export type Attachment = {
  id: string
  originalName: string
  mimeType: string
  byteSize: number
  /** Authenticated URL (relative to origin) — fetch with credentials. */
  url: string
}

export type Message = {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  editedAt?: string | null
  attachments?: Attachment[]
}

// Payload of the `message:new` socket event — same as Message plus groupId.
export type IncomingMessage = Message & { groupId: string }

export type WorkspaceMember = {
  id: string
  displayName: string
  email: string
  role: string
}

// A person returned by the platform-wide directory search. `connection` is
// the caller's connection state with this user (null if none exists).
export type DirectoryUser = {
  id: string
  displayName: string
  email: string
  workspace: { id: string; name: string }
  sameWorkspace: boolean
  connection: {
    status: 'pending' | 'accepted' | 'declined'
    requestedByMe: boolean
  } | null
}

export type ConnectionUser = {
  id: string
  displayName: string
  email: string
  workspace: { id: string; name: string }
}

export type Connection = {
  id: string
  status: 'pending' | 'accepted' | 'declined'
  message: string | null
  requestedAt: string
  respondedAt: string | null
  otherUser: ConnectionUser
}

export type ConnectionsResponse = {
  accepted: Connection[]
  pendingReceived: Connection[]
  pendingSent: Connection[]
}
