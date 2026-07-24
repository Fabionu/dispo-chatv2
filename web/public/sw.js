/* global self, clients */

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      // A visible page already shows the message in-app. Hidden or closed pages
      // need the native banner (and its browser/OS-controlled alert sound).
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((client) => client.visibilityState === 'visible')) return

      let data = {}
      try {
        data = event.data ? event.data.json() : {}
      } catch {
        data = {}
      }
      const groupId = typeof data.groupId === 'string' ? data.groupId : ''
      await self.registration.showNotification(
        typeof data.title === 'string' ? data.title : 'New message',
        {
          body: typeof data.body === 'string' ? data.body : 'Open Dispo Chat to view it.',
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: groupId ? `message:${groupId}` : 'message',
          renotify: true,
          // `silent: false` delegates sound to the browser/operating system.
          silent: false,
          data: { groupId },
        },
      )
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const groupId = event.notification.data?.groupId
  const url = groupId ? `/?notificationGroup=${encodeURIComponent(groupId)}` : '/'

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'OPEN_NOTIFICATION_GROUP', groupId })
          return
        }
      }
      await clients.openWindow(url)
    })(),
  )
})
