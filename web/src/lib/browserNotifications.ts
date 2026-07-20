import { useEffect, useState } from 'react'

const STORAGE_KEY = 'dispo:allow-browser-notifications'
const CHANGE_EVENT = 'dispo:browser-notifications-change'

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
  return getBrowserNotificationState()
}

export function disableBrowserNotifications() {
  // Browser permission remains granted; this is the application's own opt-out.
  setStoredEnabled(false)
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
  // When the app is already visible, the live conversation/sidebar plus the
  // selected custom sound are enough. Native banners are reserved for background.
  if (document.visibilityState === 'visible' && document.hasFocus()) return

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: '/favicon.svg',
      tag: `message:${options.groupId}`,
      silent: true,
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
