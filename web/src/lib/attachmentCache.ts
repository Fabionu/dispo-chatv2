// Session-level image-load cache + browser preloader for chat attachments.
//
// Lives at module scope so the "this image already finished loading" bit
// survives conversation switches within the tab: revisiting a chat renders
// already-seen images straight away instead of flashing the skeleton again
// while the browser revalidates. Nothing is persisted to disk; it lives for
// the tab, mirroring useMessageCache.
//
// Keyed by the stable attachment id (not the URL) so a just-sent image whose
// optimistic→real reconcile swaps a blob: preview for the server URL still maps
// to a single entry.

// Ids whose image bytes have decoded at least once this session.
const loaded = new Set<string>()
// Ids with a preload request currently in flight — dedupes concurrent warms.
const inflight = new Set<string>()
// Ids whose image genuinely failed to load (server error / missing object).
// Lets a revisited conversation render the "unavailable" card immediately
// instead of replaying the skeleton + slow failure. Cleared on manual retry.
// Only real load errors land here — never timeouts or offscreen/lazy state.
const failed = new Set<string>()

export function isImageLoaded(id: string): boolean {
  return loaded.has(id)
}

export function markImageLoaded(id: string): void {
  loaded.add(id)
  inflight.delete(id)
  failed.delete(id)
}

export function isImageFailed(id: string): boolean {
  return failed.has(id)
}

export function markImageFailed(id: string): void {
  failed.add(id)
  inflight.delete(id)
}

// Clear a failed mark so a manual retry can attempt the image again.
export function clearImageFailed(id: string): void {
  failed.delete(id)
}

// Warm the browser HTTP cache for an image URL without mounting an <img>, so a
// recent message's picture is ready (or already painted from cache) by the time
// its row scrolls into view. Dedupes against both already-loaded and in-flight
// ids so the same attachment is never fetched twice. `id` is the stable cache
// key; `url` is what actually gets requested (authenticated, cookie-scoped).
export function preloadImage(id: string, url: string): void {
  if (!url || loaded.has(id) || inflight.has(id) || failed.has(id)) return
  inflight.add(id)
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => markImageLoaded(id)
  img.onerror = () => {
    // A failed preload is a real load error (missing object / server error),
    // so record it: the bubble can render the unavailable card straight away.
    markImageFailed(id)
  }
  img.src = url
}
