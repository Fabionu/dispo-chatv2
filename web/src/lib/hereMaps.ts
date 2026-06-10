// HERE Maps API for JavaScript (v3.1) loader + config (frontend). The route
// planner renders the HERE *logistics* basemap with the HGV/truck restriction
// overlay, so it uses the HERE Maps JS SDK directly (not Amazon Location /
// MapLibre, which the vehicle-location modal still uses). The SDK ships as
// classic <script> bundles served from the HERE CDN — there is no clean ESM npm
// package — so we inject them on demand and resolve the global `H` namespace.
//
// The API key is read from VITE_HERE_API_KEY and is NEVER hardcoded. When it's
// missing, `hereConfigured` is false and the map UI shows a themed
// "not configured" state instead of failing.

/* eslint-disable @typescript-eslint/no-explicit-any */

// The HERE SDK attaches its namespace to `window.H`. We type it as `any` rather
// than vendoring the (large) ambient typings — every call site is localised to
// the HERE modules and the map component.
declare global {
  interface Window {
    H?: any
  }
}

export const apiKey = import.meta.env.VITE_HERE_API_KEY?.trim()

// The route planner needs a HERE key for the map, routing and search. Without it
// the feature renders a neutral "not configured" state.
export const hereConfigured = Boolean(apiKey)

// HERE Maps JS v3.1 CDN. Order matters: `core` defines the `H` namespace that the
// other bundles extend, so it must finish loading before the rest. `harp` is the
// HARP rendering engine — REQUIRED for the `vector.normal.logistics` basemap and
// its `vehicle restrictions` overlay (without it `createDefaultLayers()` doesn't
// expose `.logistics` and the HARP engine is unavailable).
const CDN = 'https://js.api.here.com/v3/3.1'
const CORE = `${CDN}/mapsjs-core.js`
const EXTRAS = [
  `${CDN}/mapsjs-service.js`,
  `${CDN}/mapsjs-mapevents.js`,
  `${CDN}/mapsjs-ui.js`,
  `${CDN}/mapsjs-harp.js`,
]
const UI_CSS = `${CDN}/mapsjs-ui.css`

let loadPromise: Promise<any> | null = null

// Inject a <script> once (keyed by src) and resolve when it has loaded. Re-uses
// an existing tag if the page already has it (e.g. after an HMR remount).
// `async = false` keeps execution in insertion order as a defensive measure;
// loadHere() also awaits each bundle in sequence, so ordering is guaranteed (core
// must run before the bundles that extend its `H` namespace).
function loadScript(src: string): Promise<void> {
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
    el.async = false
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true'
      resolve()
    })
    el.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.appendChild(el)
  })
}

function loadStylesheet(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

// Load the HERE Maps JS SDK once and resolve the global `H` namespace. Subsequent
// calls return the same in-flight/settled promise, so multiple mounts share one
// load. Throws if the key is missing or the CDN can't be reached.
export async function loadHere(): Promise<any> {
  if (!apiKey) throw new Error('VITE_HERE_API_KEY is not set')
  if (window.H) return window.H
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    loadStylesheet(UI_CSS)
    // Load deterministically: core defines the `H` namespace first, then each
    // extension bundle (service / mapevents / ui / harp) runs after it, one at a
    // time. Sequential awaits make the execution order explicit and easy to reason
    // about — `H` (and the HARP engine) are guaranteed ready once this resolves.
    await loadScript(CORE)
    for (const src of EXTRAS) {
      await loadScript(src)
    }
    if (!window.H) throw new Error('HERE SDK loaded but window.H is undefined')
    return window.H
  })()
  return loadPromise
}
