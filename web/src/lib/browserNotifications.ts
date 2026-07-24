import { useEffect, useState } from 'react'

const STORAGE_KEY = 'dispo:allow-browser-notifications'
const PUSH_ACTIVE_KEY = 'dispo:push-subscription-active'
const CHANGE_EVENT = 'dispo:browser-notifications-change'
export const NOTIFICATION_OPEN_EVENT = 'dispo:notification-open'

export type BrowserNotificationState = {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  enabled: boolean
}

function storedEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function getBrowserNotificationState(): BrowserNotificationState {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  if (!supported) return { supported: false, permission: 'unsupported', enabled: false }
  const permission = Notification.permission
  return {
    supported: true,
    permission,
    enabled: permission === 'granted' && storedEnabled(),
  }
}

function setStoredEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // Keep the current page in sync even when persistent storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function setPushActive(active: boolean) {
  try {
    localStorage.setItem(PUSH_ACTIVE_KEY, String(active))
  } catch {
    // The current page can still use its socket-driven fallback.
  }
}

function pushActive() {
  try {
    return localStorage.getItem(PUSH_ACTIVE_KEY) === 'true'
  } catch {
    return false
  }
}

export function backgroundPushIsActive() {
  return pushActive()
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(subscription: PushSubscription, publicKey: Uint8Array<ArrayBuffer>) {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === publicKey.length && bytes.every((byte, index) => byte === publicKey[index])
}

async function registerPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setPushActive(false)
    return false
  }
  try {
    const keyResponse = await fetch('/api/notifications/vapid-public-key', {
      credentials: 'include',
    })
    if (!keyResponse.ok) {
      setPushActive(false)
      return false
    }
    const { publicKey } = (await keyResponse.json()) as { publicKey: string }
    const applicationServerKey = base64UrlBytes(publicKey)
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready

    let subscription = await registration.pushManager.getSubscription()
    if (subscription && !sameKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })

    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      setPushActive(false)
      return false
    }
    const response = await fetch('/api/notifications/subscriptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    })
    const active = response.ok
    setPushActive(active)
    return active
  } catch {
    setPushActive(false)
    return false
  }
}

let pushRegistrationInFlight: Promise<boolean> | null = null

function ensurePushSubscription(): Promise<boolean> {
  if (!pushRegistrationInFlight) {
    pushRegistrationInFlight = registerPushSubscription().finally(() => {
      pushRegistrationInFlight = null
    })
  }
  return pushRegistrationInFlight
}

// Reattach an existing opt-in after sign-in or a deployment. This also repairs
// subscriptions when the service worker or VAPID public key changed.
export async function syncBrowserNotificationSubscription() {
  if (!('Notification' in window) || !storedEnabled()) return
  if (Notification.permission !== 'granted') {
    await unregisterBrowserPushSubscription()
    return
  }
  await ensurePushSubscription()
}

// Detach this browser from the current account before sign-out/opt-out, so a
// shared computer cannot keep receiving the previous user's messages.
export async function unregisterBrowserPushSubscription() {
  if (!('serviceWorker' in navigator)) {
    setPushActive(false)
    return
  }
  try {
    // Avoid racing sign-out against the signed-in mount's registration request.
    await pushRegistrationInFlight?.catch(() => {})
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      await fetch('/api/notifications/subscriptions', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {})
      await subscription.unsubscribe()
    }
  } finally {
    setPushActive(false)
  }
}

export async function enableBrowserNotifications(): Promise<BrowserNotificationState> {
  const current = getBrowserNotificationState()
  if (!current.supported) return current

  let permission = current.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = Notification.permission
    }
  }
  setStoredEnabled(permission === 'granted')
  if (permission === 'granted') await ensurePushSubscription()
  return getBrowserNotificationState()
}

export async function disableBrowserNotifications() {
  // Browser permission remains granted; this is the application's own opt-out.
  setStoredEnabled(false)
  await unregisterBrowserPushSubscription()
}

export function useBrowserNotifications(): BrowserNotificationState {
  const [state, setState] = useState(getBrowserNotificationState)

  useEffect(() => {
    const refresh = () => setState(getBrowserNotificationState())
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return state
}

export function showIncomingMessageNotification(options: {
  title: string
  body: string
  groupId: string
  onClick?: () => void
}) {
  const state = getBrowserNotificationState()
  if (!state.enabled) return
  // A registered service worker owns background banners. Avoid a duplicate
  // Notification here while the live page continues to play the chosen sound.
  if (pushActive()) return
  // When the app is already visible, the live conversation/sidebar plus the
  // selected custom sound are enough. Native banners are reserved for background.
  if (document.visibilityState === 'visible' && document.hasFocus()) return

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: '/favicon.svg',
      tag: `message:${options.groupId}`,
      // Uses the browser/OS default alert sound when custom page audio cannot.
      silent: false,
    })
    notification.onclick = () => {
      window.focus()
      options.onClick?.()
      notification.close()
    }
  } catch {
    // Some embedded browsers expose the API but still reject construction.
  }
}

export function initBrowserNotifications() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'OPEN_NOTIFICATION_GROUP' || !event.data.groupId) return
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_OPEN_EVENT, { detail: { groupId: event.data.groupId } }),
    )
  })
}
