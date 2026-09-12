// The HGV restriction layer, drawn OVER the Google basemap.
//
// WHAT IT IS. HERE's truck restriction signs — height, weight, width and
// length limits, no-truck roads — as a transparent tile layer on top of
// whatever Google map is showing (user, 2026-09-11: apps do this; the engine
// swap to HERE's logistics basemap read as "the button does nothing" because
// the whole map changed instead of something being added to it).
//
// WHERE THE TILES COME FROM. HERE's Raster Tile API v3 has no truck-only
// resource, but its `label` resource in the `logistics.day` style is a
// transparent PNG that carries the restriction signs — together with every
// street name, which over Google's own street names would be double
// lettering. The server proxies the tile (/api/here/tiles/hgv, key
// server-side); this module fetches it, draws it on a canvas and keeps ONLY
// the signs, which is possible because they are the one thing on the tile in
// HERE's sign red (rgb 251,24,88 rings): every pixel within a sign's radius
// of a red pixel stays, everything else goes transparent. A street name that
// runs right past a sign keeps a fragment inside that halo; that is the cost,
// and it is small.
//
// HOW IT IS DRAWN. Google's `MapType` interface lets a tile be any element, so
// each tile is a <canvas> at 512 device pixels shown at 256 CSS pixels — crisp
// on a hi-DPI screen — filled asynchronously once the tile arrives. The
// element is handed back to Google at once (empty), which is what the
// interface expects; a tile that has scrolled away before its fetch finished
// is dropped by `releaseTile`.

// Google's tile grid is 256 CSS px; HERE serves 512 so the signs are sharp.
const TILE_CSS = 256
const TILE_PX = 512
// HERE draws the signs from about z11; below z10 the tile is street names
// only and the fetch would be spent on pixels that all get dropped.
const MIN_ZOOM = 10
const MAX_ZOOM = 20
// The sign ring's ink (sampled off a live tile) and how far from a ring pixel
// a pixel may be and still belong to the sign — the ring's own radius (~31px
// at 512 with the server's `ppi=200`) plus a little, so the interior and the
// anti-aliased edge survive. Change the server's ppi and change this.
const KEEP_RADIUS_PX = 35

function isSignRed(r: number, g: number, b: number, a: number): boolean {
  return a > 96 && r > 190 && g < 110 && b < 150 && r - g > 110
}

/**
 * Zero every pixel that is not within KEEP_RADIUS_PX (Chebyshev) of a sign-red
 * pixel. Two separable passes — nearest red to the left/right per row, then
 * per column over that — so the cost is linear in the pixel count rather than
 * in pixels × window.
 */
function keepSignsOnly(image: ImageData): ImageData {
  const { width, height, data } = image
  const n = width * height
  // 1 = within reach of red after the row pass.
  const rows = new Uint8Array(n)
  const INF = 1 << 20
  for (let y = 0; y < height; y++) {
    const row = y * width
    let since = INF
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4
      if (isSignRed(data[i], data[i + 1], data[i + 2], data[i + 3])) since = 0
      else since++
      if (since <= KEEP_RADIUS_PX) rows[row + x] = 1
    }
    since = INF
    for (let x = width - 1; x >= 0; x--) {
      const i = (row + x) * 4
      if (isSignRed(data[i], data[i + 1], data[i + 2], data[i + 3])) since = 0
      else since++
      if (since <= KEEP_RADIUS_PX) rows[row + x] = 1
    }
  }
  const keep = new Uint8Array(n)
  for (let x = 0; x < width; x++) {
    let since = INF
    for (let y = 0; y < height; y++) {
      const p = y * width + x
      if (rows[p]) since = 0
      else since++
      if (since <= KEEP_RADIUS_PX) keep[p] = 1
    }
    since = INF
    for (let y = height - 1; y >= 0; y--) {
      const p = y * width + x
      if (rows[p]) since = 0
      else since++
      if (since <= KEEP_RADIUS_PX) keep[p] = 1
    }
  }
  for (let p = 0; p < n; p++) if (!keep[p]) data[p * 4 + 3] = 0
  return image
}

type Tile = HTMLCanvasElement & { __hgv?: { cancelled: boolean } }

/**
 * A Google `MapType` for `map.overlayMapTypes`. One instance per map; push to
 * show, remove to hide. Tiles fetched while shown are the browser's to cache.
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
      const canvas = ownerDocument.createElement('canvas') as Tile
      canvas.width = TILE_PX
      canvas.height = TILE_PX
      canvas.style.width = `${TILE_CSS}px`
      canvas.style.height = `${TILE_CSS}px`
      const state = { cancelled: false }
      canvas.__hgv = state
      if (!coord || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return canvas
      // Google hands x past the antimeridian as-is; wrap it into the grid.
      const n = 2 ** zoom
      const x = ((coord.x % n) + n) % n
      const y = coord.y
      if (y < 0 || y >= n) return canvas
      void fetch(`/api/here/tiles/hgv/${zoom}/${x}/${y}`, { credentials: 'include' })
        .then(async (res) => {
          if (state.cancelled || res.status === 204 || !res.ok) return
          const bitmap = await createImageBitmap(await res.blob())
          if (state.cancelled) return
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.drawImage(bitmap, 0, 0, TILE_PX, TILE_PX)
          ctx.putImageData(keepSignsOnly(ctx.getImageData(0, 0, TILE_PX, TILE_PX)), 0, 0)
        })
        .catch(() => {
          // A tile that fails to load is simply an empty tile; the next pan
          // asks again.
        })
      return canvas
    },
    releaseTile(tile: Element | null) {
      const state = (tile as Tile | null)?.__hgv
      if (state) state.cancelled = true
    },
  }
}
