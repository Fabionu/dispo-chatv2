// Loads the Google Maps JavaScript API once and hands back its namespace.
//
// THE KEY IS IN THE BROWSER, ON PURPOSE. This is the opposite of the HERE
// arrangement (server-side key, auth-gated /api/here/config), and it is not an
// oversight: Google's Maps JS key is designed to be public and is protected by
// HTTP-referrer restrictions in the Cloud console, not by secrecy — proxying the
// SDK's own requests would break it. The env var is Vite-exposed (`VITE_`
// prefix) for exactly that reason.
//
// One script tag, every library named up front, resolved on Google's callback.
// Simpler than the "dynamic import" bootstrap and just as supported; the app
// needs the same three libraries on every map it draws, so lazy per-library
// loading would buy nothing.

declare global {
  interface Window {
    google?: typeof google
    __dispoGoogleMapsLoading?: Promise<typeof google>
    __dispoGoogleMapsReady?: () => void
  }
}

const LIBRARIES = 'maps,marker,geometry'

export function googleMapsKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() ?? ''
}

export function loadGoogle(): Promise<typeof google> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google)
  if (window.__dispoGoogleMapsLoading) return window.__dispoGoogleMapsLoading

  const key = googleMapsKey()
  if (!key) return Promise.reject(new Error('VITE_GOOGLE_MAPS_KEY is not set'))

  window.__dispoGoogleMapsLoading = new Promise<typeof google>((resolve, reject) => {
    window.__dispoGoogleMapsReady = () => {
      delete window.__dispoGoogleMapsReady
      if (window.google?.maps?.Map) resolve(window.google)
      else reject(new Error('Google Maps loaded without google.maps.Map'))
    }
    const query = new URLSearchParams({
      key,
      v: 'weekly',
      libraries: LIBRARIES,
      loading: 'async',
      callback: '__dispoGoogleMapsReady',
    })
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${query.toString()}`
    script.async = true
    script.onerror = () => {
      delete window.__dispoGoogleMapsLoading
      reject(new Error('The Google Maps script could not be loaded'))
    }
    document.head.appendChild(script)
  })
  return window.__dispoGoogleMapsLoading
}
