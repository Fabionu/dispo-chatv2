import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { canManageRoom, canManageRoomRoles, type RoomViewer } from './roomPermissions'

// Must agree with server/src/routes/groups/authz.ts: a company role only counts
// in the company's own rooms; a room admin counts anywhere.

const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARTNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const hostRoom = { workspaceId: HOST, myRole: 'member' as const }
const viewer = (role: RoomViewer['role'], workspaceId = HOST): RoomViewer => ({ role, workspaceId })

describe('canManageRoom', () => {
  test("the owning company's admins and dispatchers manage it", () => {
    assert.equal(canManageRoom(hostRoom, viewer('admin')), true)
    assert.equal(canManageRoom(hostRoom, viewer('dispatcher')), true)
    assert.equal(canManageRoom(hostRoom, viewer('driver')), false)
  })

  test("a partner company's admin sees no management controls", () => {
    assert.equal(canManageRoom(hostRoom, viewer('admin', PARTNER)), false)
    assert.equal(canManageRoom(hostRoom, viewer('dispatcher', PARTNER)), false)
  })

  test('a room admin manages it from any company', () => {
    assert.equal(canManageRoom({ ...hostRoom, myRole: 'admin' }, viewer('driver', PARTNER)), true)
  })

  test('the live member-list role wins over the room list', () => {
    assert.equal(canManageRoom({ ...hostRoom, myRole: 'admin' }, viewer('driver', PARTNER), 'member'), false)
    assert.equal(canManageRoom(hostRoom, viewer('driver', PARTNER), 'admin'), true)
  })

  test('an optimistic row with no known owner grants nothing by company role', () => {
    assert.equal(canManageRoom({}, viewer('admin')), false)
  })
})

describe('canManageRoomRoles', () => {
  test("only the owning company's admins, not dispatchers or partners", () => {
    assert.equal(canManageRoomRoles(hostRoom, viewer('admin')), true)
    assert.equal(canManageRoomRoles(hostRoom, viewer('dispatcher')), false)
    assert.equal(canManageRoomRoles(hostRoom, viewer('admin', PARTNER)), false)
  })
})
