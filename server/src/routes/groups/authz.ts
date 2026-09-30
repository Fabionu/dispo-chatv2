import { type DbClient } from '../../db/pool.js'
import { HttpError } from '../../http.js'

// ── The rule, as pure predicates ─────────────────────────────────────────
// A vehicle room belongs to one company (groups.workspace_id), but its members
// can come from several: accepted cross-company connections are invited in as
// partners. A member's COMPANY role (users.role) describes their standing in
// their own company, so it only carries weight in a room that company owns —
// otherwise every outside member would manage the room, because nearly all of
// them are admins or dispatchers at home (signup makes you your company's
// admin). The ROOM role (group_members.role) is granted per room, so a room
// admin manages the room whatever company they come from: that is how a host
// deliberately hands a partner control.
export type RoomStanding = {
  groupRole: string
  userRole: string
  userWorkspaceId: string
  groupWorkspaceId: string | null
}

function ownCompanyRoom(s: RoomStanding): boolean {
  return s.groupWorkspaceId !== null && s.userWorkspaceId === s.groupWorkspaceId
}

/** Invite, edit the room and its trip, manage the avatar, cancel invites:
 *  a room admin, or an admin/dispatcher of the company that owns the room. */
export function canManageRoom(s: RoomStanding): boolean {
  if (s.groupRole === 'admin') return true
  return ownCompanyRoom(s) && (s.userRole === 'admin' || s.userRole === 'dispatcher')
}

/** Change room roles and remove members — stricter than canManageRoom:
 *  a room admin, or an admin (not a dispatcher) of the owning company. */
export function canManageRoomRoles(s: RoomStanding): boolean {
  if (s.groupRole === 'admin') return true
  return ownCompanyRoom(s) && s.userRole === 'admin'
}

// The caller's standing in one room: their room role, company role, and both
// companies. No row = not a member.
async function loadStanding(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<(RoomStanding & { type: 'vehicle' | 'direct' }) | undefined> {
  const { rows } = await client.query<{
    group_role: string
    user_role: string
    user_workspace_id: string
    group_workspace_id: string | null
    type: 'vehicle' | 'direct'
  }>(
    `select gm.role as group_role, u.role as user_role,
            u.workspace_id as user_workspace_id, g.workspace_id as group_workspace_id, g.type
       from group_members gm
       join users u on u.id = gm.user_id
       join groups g on g.id = gm.group_id
      where gm.group_id = $1 and gm.user_id = $2`,
    [groupId, userId],
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    groupRole: row.group_role,
    userRole: row.user_role,
    userWorkspaceId: row.user_workspace_id,
    groupWorkspaceId: row.group_workspace_id,
    type: row.type,
  }
}

// ── Invite authorization ─────────────────────────────────────────────────
// Who may invite into a vehicle group: see canManageRoom. Returns the group's
// workspace_id (for the same-workspace check on invitees) or throws the right
// HttpError.
//
// Also the boundary for "manage this group" actions that share the same
// permission model as inviting (editing group details, avatar management).
export async function authorizeInviter(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<{ workspaceId: string | null }> {
  const standing = await loadStanding(client, groupId, userId)
  if (!standing) throw new HttpError(403, 'not_a_member')
  // Invitations are a vehicle-group concept — DMs are a fixed pair.
  if (standing.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  if (!canManageRoom(standing)) throw new HttpError(403, 'forbidden')
  return { workspaceId: standing.groupWorkspaceId }
}

// ── Role-management authorization ─────────────────────────────────────────
// Who may change a vehicle group's member roles or remove members: see
// canManageRoomRoles. Throws the right HttpError; returns nothing on success.
export async function authorizeRoleManager(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<void> {
  const standing = await loadStanding(client, groupId, userId)
  if (!standing) throw new HttpError(403, 'not_a_member')
  // Group roles are a vehicle-group concept — DMs are a fixed pair.
  if (standing.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  if (!canManageRoomRoles(standing)) throw new HttpError(403, 'forbidden')
}

// ── Invite-cancel authorization ───────────────────────────────────────────
// Whether the caller may rescind someone ELSE's pending invite to this room
// (the inviter may always cancel their own; the route checks that first).
export async function mayCancelRoomInvites(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const standing = await loadStanding(client, groupId, userId)
  return standing !== undefined && canManageRoom(standing)
}
