// The HERE Maps API for JavaScript loader — RETIRED.
//
// Until 2026-09-11 this injected HERE's v3.2 scripts and fetched the API key
// from GET /api/here/config for `H.service.Platform`. Two things ended that:
// the basemap is Google's now (components/map/MapView.tsx — the HGV layer is a
// tile overlay, not an engine swap), and the key endpoint handed the SERVER's
// paid HERE key to any signed-in user, so it was removed (2026-09-12). HERE is
// server-proxied only (/api/here/*, lib/api.ts `here`).
//
// `HereMap.tsx` stays in the tree as the reference for the drag/snap/hover
// machinery GoogleMap ported, which is why this module still exists and still
// type-checks against it. Mounting HereMap again is not a matter of restoring
// the fetch: a browser-side HERE key has to be a SEPARATE, referrer-restricted
// key issued for that purpose — never the server's.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    H?: any
  }
}

export function loadHere(): Promise<{ H: any; apiKey: string }> {
  return Promise.reject(
    new Error(
      'HERE Maps JS is retired: no browser key is issued (web/src/lib/here/loadHere.ts)',
    ),
  )
}
