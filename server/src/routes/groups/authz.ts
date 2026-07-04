import { type DbClient } from '../../db/pool.js'
import { HttpError } from '../../http.js'

// ── Invite authorization ─────────────────────────────────────────────────
// Who may invite into a vehicle group: a member who is either a group admin OR
// a workspace admin/dispatcher. Returns the group's workspace_id (for the
// same-workspace check on invitees) or throws the right HttpError.
//
// Also the boundary for "manage this group" actions that share the same
// permission model as inviting (editing group details, avatar management).
export async function authorizeInviter(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<{ workspaceId: string | null }> {
  const { rows } = await client.query<{
    group_role: string
    user_role: string
    workspace_id: string | null
    type: 'vehicle' | 'direct'
  }>(
    `select gm.role as group_role, u.role as user_role, g.workspace_id, g.type
       from group_members gm
       join users u on u.id = gm.user_id
       join groups g on g.id = gm.group_id
      where gm.group_id = $1 and gm.user_id = $2`,
    [groupId, userId],
  )
  const row = rows[0]
  if (!row) throw new HttpError(403, 'not_a_member')
  // Invitations are a vehicle-group concept — DMs are a fixed pair.
  if (row.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  const allowed =
    row.group_role === 'admin' || row.user_role === 'admin' || row.user_role === 'dispatcher'
  if (!allowed) throw new HttpError(403, 'forbidden')
  return { workspaceId: row.workspace_id }
}

// ── Role-management authorization ─────────────────────────────────────────
// Who may change a vehicle group's member roles: a GROUP admin OR a WORKSPACE
// admin. Note this is STRICTER than inviting (which also allows dispatchers) —
// promoting/demoting admins is a privileged action. Throws the right HttpError;
// returns nothing on success.
export async function authorizeRoleManager(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<void> {
  const { rows } = await client.query<{
    group_role: string
    user_role: string
    type: 'vehicle' | 'direct'
  }>(
    `select gm.role as group_role, u.role as user_role, g.type
       from group_members gm
       join users u on u.id = gm.user_id
       join groups g on g.id = gm.group_id
      where gm.group_id = $1 and gm.user_id = $2`,
    [groupId, userId],
  )
  const row = rows[0]
  if (!row) throw new HttpError(403, 'not_a_member')
  // Group roles are a vehicle-group concept — DMs are a fixed pair.
  if (row.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  if (row.group_role !== 'admin' && row.user_role !== 'admin') {
    throw new HttpError(403, 'forbidden')
  }
}
