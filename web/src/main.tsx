import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDensity } from './lib/density'

// Pick the display-density tier (compact/default/comfortable) before first
// paint so large monitors render at a comfortable scale with no flash.
initDensity()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
