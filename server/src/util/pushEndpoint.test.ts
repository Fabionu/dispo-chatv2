import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isAcceptablePushEndpoint } from './pushEndpoint.js'

// The boundary: the server POSTs to whatever endpoint a user registers, so
// anything that could point that POST at the inside of the deployment is
// refused, while every real browser push service passes.

describe('isAcceptablePushEndpoint', () => {
  test('accepts the endpoints real browsers hand out', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bE...',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
      'https://web.push.apple.com/QGZ2b3JkZXI',
      'https://db5p.notify.windows.com/w/?token=BQYAAAB',
      'https://FCM.GOOGLEAPIS.COM/fcm/send/x',
    ]) {
      assert.equal(isAcceptablePushEndpoint(url), true, url)
    }
  })

  test('refuses plain http', () => {
    assert.equal(isAcceptablePushEndpoint('http://fcm.googleapis.com/fcm/send/x'), false)
  })

  test('refuses IP literals, loopback and internal names', () => {
    for (const url of [
      'https://10.0.0.5/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://[fd00::1]/x',
      'https://localhost/',
      'https://redis/',
      'https://postgres.railway.internal/',
      'https://api.local/',
      'https://box.localdomain/',
    ]) {
      assert.equal(isAcceptablePushEndpoint(url), false, url)
    }
  })

  test('refuses explicit ports and embedded credentials', () => {
    assert.equal(isAcceptablePushEndpoint('https://fcm.googleapis.com:6379/'), false)
    assert.equal(isAcceptablePushEndpoint('https://fcm.googleapis.com:8443/x'), false)
    assert.equal(isAcceptablePushEndpoint('https://user:pw@fcm.googleapis.com/x'), false)
    // An explicit default port normalises to '' and is still fine.
    assert.equal(isAcceptablePushEndpoint('https://fcm.googleapis.com:443/x'), true)
  })

  test('refuses things that are not URLs at all', () => {
    assert.equal(isAcceptablePushEndpoint('not a url'), false)
    assert.equal(isAcceptablePushEndpoint(''), false)
    assert.equal(isAcceptablePushEndpoint('javascript:alert(1)'), false)
  })
})
