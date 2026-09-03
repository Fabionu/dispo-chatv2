import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDensity } from './lib/density'
import { initTheme } from './lib/theme'
import { initMessageStyle } from './lib/messageStyle'
import { initAnimations } from './lib/animations'
import { initNotificationSound } from './lib/notificationSound'
import { initBrowserNotifications } from './lib/browserNotifications'

// Apply the saved palette before React paints so neither signed-out nor
// workspace screens flash the opposite theme.
initTheme()
// Pick the display-density tier (compact/default/comfortable) before first
// paint so large monitors render at a comfortable scale with no flash.
initDensity()
// Apply the saved message style (timeline/bubble) before first paint, so the
// thread is never drawn one way and then repainted the other.
initMessageStyle()
// Apply the animation preferences (interface animations on/off, and which
// effect the composer plays) before first paint, so nothing runs an entrance
// the user has switched off.
initAnimations()
// Unlock Web Audio on the first user gesture so later socket notifications can
// play even when they arrive while the app is in the background.
initNotificationSound()
// Listen for notification clicks forwarded by the service worker.
initBrowserNotifications()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
