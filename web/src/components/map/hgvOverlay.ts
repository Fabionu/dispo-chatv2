// The HGV restriction layer, drawn OVER the Google basemap.
//
// WHAT IT IS. HERE's truck restriction signs — height, weight, width and
// length limits, no-truck roads — as a transparent tile layer on top of
// whatever Google map is showing (user, 2026-09-11: apps do this; the engine
// swap to HERE's logistics basemap read as "the button does nothing" because
// the whole map changed instead of something being added to it).
//
// WHERE THE TILES COME FROM. The server proxies HERE's Raster Tile API
// (/api/here/tiles/hgv, key server-side) and strips everything but the signs
// (server/src/util/hgvSigns.ts), caching the finished tile. HERE bills per
// upstream request, so all the client does is show those PNGs: no pixel work
// here, which is what kept the map smooth with the layer on.
//
// HOW IT IS DRAWN. Google's `MapType` interface lets a tile be any element, so
// each tile is an <img> at 256 CSS pixels (the PNG is 512, crisp on hi-DPI).
// Its fetch starts only after FETCH_DELAY_MS: a wheel/pinch zoom or a fast pan
// releases tiles within milliseconds, and those never reach the network.

// Google's tile grid is 256 CSS px; HERE serves 512 so the signs are sharp.
const TILE_CSS = 256
// HERE draws the signs from about z11; below z10 the tile is street names
// only and would hold no sign.
const MIN_ZOOM = 10
const MAX_ZOOM = 20
const FETCH_DELAY_MS = 200

type Tile = HTMLImageElement & { __hgvTimer?: number }

/**
 * A Google `MapType` for `map.overlayMapTypes`. One instance per map; push to
 * show, remove to hide. Tiles are the browser's to cache (the server sends a
 * week-long Cache-Control).
 */
export function createHgvOverlay(g: typeof google): google.maps.MapType {
  return {
    tileSize: new g.maps.Size(TILE_CSS, TILE_CSS),
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    name: 'HGV restrictions',
    alt: 'HERE truck restriction signs',
    projection: null,
    radius: 6378137,
    getTile(coord: google.maps.Point | null, zoom: number, ownerDocument: Document): Element {
      const img = ownerDocument.createElement('img') as Tile
      img.style.width = `${TILE_CSS}px`
      img.style.height = `${TILE_CSS}px`
      img.alt = ''
      img.decoding = 'async'
      img.draggable = false
      // A tile with no sign (204) or a refused one is just an empty tile.
      img.onerror = () => {
        img.style.visibility = 'hidden'
      }
      if (!coord || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return img
      // Google hands x past the antimeridian as-is; wrap it into the grid.
      const n = 2 ** zoom
      const x = ((coord.x % n) + n) % n
      const y = coord.y
      if (y < 0 || y >= n) return img
      img.__hgvTimer = window.setTimeout(() => {
        img.src = `/api/here/tiles/hgv/${zoom}/${x}/${y}`
      }, FETCH_DELAY_MS)
      return img
    },
    releaseTile(tile: Element | null) {
      const img = tile as Tile | null
      if (!img) return
      window.clearTimeout(img.__hgvTimer)
      // Stops a download still in flight for a tile that scrolled away.
      img.removeAttribute('src')
    },
  }
}
