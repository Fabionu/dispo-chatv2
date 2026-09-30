import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { canManageRoom, canManageRoomRoles, type RoomStanding } from './authz.js'

// The boundary these tests defend: a company role only counts inside that
// company's own rooms. A partner who is an admin or dispatcher AT HOME is a
// plain member in someone else's room unless the host made them a room admin.

const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARTNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function standing(overrides: Partial<RoomStanding>): RoomStanding {
  return {
    groupRole: 'member',
    userRole: 'driver',
    userWorkspaceId: HOST,
    groupWorkspaceId: HOST,
    ...overrides,
  }
}

describe('canManageRoom', () => {
  test("the owning company's admins and dispatchers manage the room", () => {
    assert.equal(canManageRoom(standing({ userRole: 'admin' })), true)
    assert.equal(canManageRoom(standing({ userRole: 'dispatcher' })), true)
  })

  test("the owning company's drivers and partners do not", () => {
    assert.equal(canManageRoom(standing({ userRole: 'driver' })), false)
    assert.equal(canManageRoom(standing({ userRole: 'partner' })), false)
  })

  test("another company's admin or dispatcher does not manage the room", () => {
    for (const userRole of ['admin', 'dispatcher']) {
      assert.equal(canManageRoom(standing({ userRole, userWorkspaceId: PARTNER })), false)
    }
  })

  test('a room admin manages the room whatever company they come from', () => {
    assert.equal(canManageRoom(standing({ groupRole: 'admin' })), true)
    assert.equal(
      canManageRoom(standing({ groupRole: 'admin', userWorkspaceId: PARTNER })),
      true,
    )
  })

  test('a room with no owning company grants nothing by company role', () => {
    assert.equal(canManageRoom(standing({ userRole: 'admin', groupWorkspaceId: null })), false)
  })
})

describe('canManageRoomRoles', () => {
  test("only the owning company's admins, not its dispatchers", () => {
    assert.equal(canManageRoomRoles(standing({ userRole: 'admin' })), true)
    assert.equal(canManageRoomRoles(standing({ userRole: 'dispatcher' })), false)
  })

  test("another company's admin cannot change roles or remove members", () => {
    assert.equal(
      canManageRoomRoles(standing({ userRole: 'admin', userWorkspaceId: PARTNER })),
      false,
    )
  })

  test('a room admin can, from any company', () => {
    assert.equal(
      canManageRoomRoles(standing({ groupRole: 'admin', userWorkspaceId: PARTNER })),
      true,
    )
  })
})
