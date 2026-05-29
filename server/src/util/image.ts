import sharp from 'sharp'

// Longest-edge cap for chat-bubble previews. 960px keeps a preview crisp on
// HiDPI displays at the bubble's max render width while being a fraction of a
// multi-megapixel original's bytes.
export const PREVIEW_MAX_DIM = 960

export type GeneratedPreview = {
  /** WebP-encoded preview bytes. */
  buffer: Buffer
  /** Dimensions of the PREVIEW (upright, downscaled). Shares the original's
   *  aspect ratio, which is all the client needs to reserve the bubble box and
   *  avoid layout shift while the preview decodes. */
  width: number
  height: number
}

// Build a downscaled WebP preview for an image upload. Returns null when a
// preview isn't worth generating (animated GIFs — we keep the animated
// original in the bubble — or anything sharp can't decode), in which case the
// caller leaves preview_path NULL and the bubble falls back to the original.
//
// `.rotate()` with no args bakes in EXIF orientation so the stored preview is
// upright and its reported width/height match what the browser will paint.
export async function makePreview(
  buffer: Buffer,
  mime: string,
): Promise<GeneratedPreview | null> {
  // Animated GIFs lose their animation when flattened to a static preview, and
  // an animated-WebP re-encode is rarely smaller — keep the original in-bubble.
  if (mime === 'image/gif') return null

  try {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: PREVIEW_MAX_DIM,
        height: PREVIEW_MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })

    if (!info.width || !info.height) return null
    return { buffer: data, width: info.width, height: info.height }
  } catch {
    // Corrupt/undecodable image — skip the preview, serve the original.
    return null
  }
}
