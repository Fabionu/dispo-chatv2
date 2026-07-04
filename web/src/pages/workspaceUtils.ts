import type { ConnectionUser, Group } from '../lib/types'

export function byRecent(a: Group, b: Group): number {
  const at = a.lastMessageAt ?? a.createdAt
  const bt = b.lastMessageAt ?? b.createdAt
  return bt.localeCompare(at)
}

// Shape an optimistic direct-message Group from what we already know about
// the other user, so the rail can render the row before the server confirms.
// `refreshGroups()` will replace this with the canonical record.
export function optimisticDirectGroup(id: string, other: ConnectionUser): Group {
  const now = new Date().toISOString()
  return {
    id,
    type: 'direct',
    name: null,
    description: null,
    meta: {},
    lastMessageAt: null,
    lastReadAt: now,
    createdAt: now,
    memberCount: 2,
    unreadCount: 0,
    directPeer: { id: other.id, name: other.displayName, workspace: other.workspace.name },
  }
}
