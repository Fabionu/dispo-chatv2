import sharp from 'sharp'

// Keeps ONLY the truck-restriction signs of a HERE `logistics.day` label tile.
// The tile carries the signs together with every street name; over Google's own
// street names the latter would be double lettering. The signs are the one
// thing drawn in HERE's sign red (rgb 251,24,88 rings), so every pixel within
// a sign's radius of a red pixel stays and everything else goes transparent. A
// street name running right past a sign keeps a fragment inside that halo.
//
// Done once per tile on the server (and the result cached) instead of per view
// in every browser: it is a full-tile pixel scan, which on the main thread of
// ~50 tiles per screen is what made the map stutter with the layer on.

// How far from a ring pixel a pixel may be and still belong to the sign — the
// ring's own radius (~31px at 512 with `ppi=200`) plus a little. Change the
// tile request's ppi and change this.
const KEEP_RADIUS_PX = 35

function isSignRed(r: number, g: number, b: number, a: number): boolean {
  return a > 96 && r > 190 && g < 110 && b < 150 && r - g > 110
}

/**
 * Zero the alpha of every pixel that is not within KEEP_RADIUS_PX (Chebyshev) of
 * a sign-red pixel. Two separable passes — nearest red to the left/right per
 * row, then per column over that — so the cost is linear in the pixel count.
 * Returns false when the tile holds no sign at all.
 */
function keepSignsOnly(data: Buffer, width: number, height: number): boolean {
  const n = width * height
  const rows = new Uint8Array(n)
  const INF = 1 << 20
  let any = false
  for (let y = 0; y < height; y++) {
    const row = y * width
    let since = INF
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4
      if (isSignRed(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        since = 0
        any = true
      } else since++
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
  if (!any) return false
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
  return true
}

/** The tile reduced to its signs as a PNG, or null when it has none. */
export async function extractSigns(png: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (!keepSignsOnly(data, info.width, info.height)) return null
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
