import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDensity } from './lib/density'
import { initMessageDisplay } from './lib/messageDisplay'
import { initTheme } from './lib/theme'
import { initNotificationSound } from './lib/notificationSound'

// Apply the saved palette before React paints so neither signed-out nor
// workspace screens flash the opposite theme.
initTheme()
// Pick the display-density tier (compact/default/comfortable) before first
// paint so large monitors render at a comfortable scale with no flash.
initDensity()
// Apply the saved message display style (bubble/plain) before first paint.
initMessageDisplay()
// Unlock Web Audio on the first user gesture so later socket notifications can
// play even when they arrive while the app is in the background.
initNotificationSound()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
