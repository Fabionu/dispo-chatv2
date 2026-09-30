import type { Group, Role } from './types'

// Who may manage a vehicle room — the client mirror of canManageRoom /
// canManageRoomRoles in server/src/routes/groups/authz.ts. It only decides which
// controls show; the server enforces the same rule on every call.
//
// A company role (admin / dispatcher) counts only in rooms the viewer's own
// company owns. Partners invited in from other companies are usually admins
// AT HOME, so without this they would be offered — and used to be granted —
// full control of the host's room. A ROOM admin manages the room from any
// company; that is how a host deliberately hands a partner control.

export type RoomViewer = { role: Role; workspaceId: string }

// `groupRole` is the viewer's live room role when the caller has the member list
// loaded; otherwise the room list's `myRole` is used.
type RoomRef = Pick<Group, 'workspaceId' | 'myRole'>

function isRoomAdmin(group: RoomRef, groupRole?: string): boolean {
  return (groupRole ?? group.myRole) === 'admin'
}

// An unknown owner (an optimistic row the list hasn't reconciled yet) is not
// the viewer's company: better to hide a control for a moment than to offer one
// the server refuses.
function ownCompanyRoom(group: RoomRef, viewer: RoomViewer): boolean {
  return Boolean(group.workspaceId) && group.workspaceId === viewer.workspaceId
}

/** Invite, edit details / trip / image, cancel invites. */
export function canManageRoom(group: RoomRef, viewer: RoomViewer, groupRole?: string): boolean {
  if (isRoomAdmin(group, groupRole)) return true
  return ownCompanyRoom(group, viewer) && (viewer.role === 'admin' || viewer.role === 'dispatcher')
}

/** Change room roles and remove members — company admins only, not dispatchers. */
export function canManageRoomRoles(group: RoomRef, viewer: RoomViewer, groupRole?: string): boolean {
  if (isRoomAdmin(group, groupRole)) return true
  return ownCompanyRoom(group, viewer) && viewer.role === 'admin'
}
