import { loadPdfjs } from './pdfjs'

// Session-level first-page thumbnail cache for PDF document cards.
//
// The server preview pipeline is image-only (sharp), so PDF thumbnails are
// rasterised client-side with the already-lazy-loaded pdf.js. Rendering a PDF
// is expensive, so each attachment is rendered AT MOST ONCE per session: the
// result — a small WebP object URL — is cached at module scope keyed by the
// stable attachment id, mirroring attachmentCache. A failed render caches as
// null so the card settles on the generic glyph without retry storms.
//
// Object URLs are intentionally never revoked: they are tab-lived, tiny
// (a few tens of KB each), and revoking would break a card re-mounted after a
// conversation switch.
//
// TODO(doc-thumbs): DOC/DOCX and XLS/XLSX thumbnails would need a server-side
// converter (no browser-native renderer); if the preview queue grows a
// document worker, prefer extending attachments.preview_path over this cache.
// TODO(doc-thumbs): images embedded in documents (e.g. first image of a DOCX)
// could be a cheap intermediate once a server-side parser exists.

// Rendered width in device pixels — ~2x the 15rem card band, so the thumbnail
// stays crisp on hi-dpi screens without rasterising a full page.
const TARGET_WIDTH = 480
// At most this many PDFs rasterise at once; the rest queue. Keeps a scroll
// through a document-heavy conversation from saturating CPU/network.
const MAX_CONCURRENT = 2

const thumbs = new Map<string, Promise<string | null>>()

let active = 0
const waiters: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active += 1
  try {
    return await fn()
  } finally {
    active -= 1
    waiters.shift()?.()
  }
}

async function renderFirstPage(url: string): Promise<string | null> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(Math.max(TARGET_WIDTH / base.width, 0.1), 3)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Pages can have transparent backgrounds — paint the paper white first.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.8),
    )
    return blob ? URL.createObjectURL(blob) : null
  } finally {
    void doc.destroy()
  }
}

// Resolve (or start) the thumbnail for an attachment. Never throws — a corrupt
// or unfetchable PDF resolves to null and the caller keeps its fallback glyph.
export function getPdfThumbnail(id: string, url: string): Promise<string | null> {
  let pending = thumbs.get(id)
  if (!pending) {
    pending = withSlot(() => renderFirstPage(url)).catch(() => null)
    thumbs.set(id, pending)
  }
  return pending
}
