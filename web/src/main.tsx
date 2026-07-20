import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDensity } from './lib/density'
import { initMessageDisplay } from './lib/messageDisplay'
import { initTheme } from './lib/theme'

// Apply the saved palette before React paints so neither signed-out nor
// workspace screens flash the opposite theme.
initTheme()
// Pick the display-density tier (compact/default/comfortable) before first
// paint so large monitors render at a comfortable scale with no flash.
initDensity()
// Apply the saved message display style (bubble/plain) before first paint.
initMessageDisplay()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
