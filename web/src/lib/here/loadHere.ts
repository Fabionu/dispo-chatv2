import { api } from '../api'

// Loads the HERE Maps API for JavaScript v3.2 from HERE's CDN and resolves the
// global `H` namespace plus the API key (fetched from our auth-gated proxy, so
// the key is never baked into the bundle).
//
// v3.2 notes (HARP engine, which is the default and only engine):
//  • Load ONLY core + service + mapevents + ui (+ ui.css). Do NOT load
//    mapsjs-harp.js (removed in 3.2) and never pass an `engineType` —
//    `H.Map.EngineType` no longer exists, so referencing it throws.
//  • core defines `window.H`; service/mapevents/ui each only extend core, so
//    they can load in parallel AFTER core resolves.
//
// The result is cached: repeated calls (e.g. remounting the map) reuse the same
// in-flight/settled promise and never re-inject the scripts.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    H?: any
  }
}

const CDN = 'https://js.api.here.com/v3/3.2'

let loadPromise: Promise<{ H: any; apiKey: string }> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true'
      resolve()
    })
    el.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.appendChild(el)
  })
}

function injectCss(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return
  const el = document.createElement('link')
  el.rel = 'stylesheet'
  el.href = href
  document.head.appendChild(el)
}

async function doLoad(): Promise<{ H: any; apiKey: string }> {
  // Key first — if HERE isn't configured the proxy 503s here and we surface a
  // clean error before touching the CDN.
  const { apiKey } = await api.here.config()

  injectCss(`${CDN}/mapsjs-ui.css`)
  // core defines H; the rest extend it, so load core, then the others together.
  await injectScript(`${CDN}/mapsjs-core.js`)
  await Promise.all([
    injectScript(`${CDN}/mapsjs-service.js`),
    injectScript(`${CDN}/mapsjs-mapevents.js`),
    injectScript(`${CDN}/mapsjs-ui.js`),
  ])

  if (!window.H) throw new Error('HERE Maps JS loaded but window.H is undefined')
  return { H: window.H, apiKey }
}

export function loadHere(): Promise<{ H: any; apiKey: string }> {
  if (!loadPromise) {
    loadPromise = doLoad().catch((err) => {
      // Reset so a later attempt can retry (e.g. after the user signs in or the
      // key is configured) instead of being stuck on the first failure.
      loadPromise = null
      throw err
    })
  }
  return loadPromise
}
