import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../http.js'
import { acceptInviteOutcome } from './groupInviteAuthz.js'

// The boundary these tests defend: an invite admits its invitee ONCE. Removing
// a member must stick — replaying the accepted invite may not re-admit them.

const INVITEE = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'

function httpErrorFrom(fn: () => unknown): HttpError {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`)
    return err
  }
  assert.fail('expected the call to throw')
}

describe('acceptInviteOutcome', () => {
  test('a pending invite joins', () => {
    const invite = { invited_user_id: INVITEE, status: 'pending' }
    assert.equal(acceptInviteOutcome(INVITEE, invite, false), 'join')
  })

  test('only the invitee may accept', () => {
    const invite = { invited_user_id: INVITEE, status: 'pending' }
    assert.equal(httpErrorFrom(() => acceptInviteOutcome(STRANGER, invite, false)).status, 403)
  })

  test('a repeat accept while still a member is an idempotent no-op', () => {
    const invite = { invited_user_id: INVITEE, status: 'accepted' }
    assert.equal(acceptInviteOutcome(INVITEE, invite, true), 'already_member')
  })

  test('a removed member cannot rejoin by replaying the accepted invite', () => {
    const invite = { invited_user_id: INVITEE, status: 'accepted' }
    const err = httpErrorFrom(() => acceptInviteOutcome(INVITEE, invite, false))
    assert.equal(err.status, 409)
    assert.equal(err.code, 'not_pending')
  })

  test('declined and cancelled invites are spent', () => {
    for (const status of ['declined', 'cancelled']) {
      const invite = { invited_user_id: INVITEE, status }
      assert.equal(httpErrorFrom(() => acceptInviteOutcome(INVITEE, invite, false)).status, 409)
    }
  })
})
