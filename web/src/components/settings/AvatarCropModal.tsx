import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'

type Props = {
  /** The image the user just picked (validated by the caller as an image). */
  file: File
  /** Dismiss without uploading. */
  onCancel: () => void
  /**
   * Confirm: hands the caller the cropped square as a File. The caller performs
   * the upload + state updates and resolves on success (which unmounts this
   * modal). It must REJECT on failure so we can surface a retryable error here
   * and keep the crop open.
   */
  onConfirm: (cropped: File) => Promise<void>
}

// Side of the square crop stage, in CSS px. The crop region IS this square; the
// circle drawn on top is the display mask (what other users see when the avatar
// renders round). Kept constant so the crop math is exact and reflow-free; the
// panel width is sized to hold it with padding on small screens.
const STAGE = 288
// Output is a square raster — stored square, displayed round (matches WhatsApp
// and our <Avatar>, which masks with rounded-full). 512px keeps it crisp on
// retina at every place we render an avatar.
const OUTPUT = 512
const MIN_ZOOM = 1
const MAX_ZOOM = 4

// WhatsApp-style avatar cropper. After picking an image the user repositions
// (drag), zooms (slider / buttons) and optionally rotates it inside a circular
// mask; only on confirm do we rasterise the selected square and upload it. A
// custom canvas cropper (no dependency): the live preview is a GPU-transformed
// <img> (smooth even for large photos — drag mutates the transform imperatively,
// never through React state), and the final crop is drawn once to an offscreen
// canvas.
export default function AvatarCropModal({ file, onCancel, onConfirm }: Props) {
  // Object-URL ownership. `baseUrl` is the picked (or replaced) file; `working`
  // is what we actually display — the same as base, or a rotated derivative we
  // baked to a fresh blob. Both are revoked when replaced and on unmount, so no
  // blob is ever leaked. Refs mirror state for synchronous cleanup decisions.
  const [baseFile, setBaseFile] = useState(file)
  const baseUrlRef = useRef<string>('')
  const workingUrlRef = useRef<string>('')
  const [workingUrl, setWorkingUrl] = useState<string>('')

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  // Image top-left offset relative to the stage, in CSS px. Source of truth for
  // position — kept in a ref so dragging doesn't trigger React re-renders.
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  // Smallest scale that still covers the square (no gaps at any rotation). zoom
  // multiplies this, so zoom=1 is "cover" and the image can only get larger.
  const baseScale = natural ? Math.max(STAGE / natural.w, STAGE / natural.h) : 1

  // Build the base object URL for the current file; revoke it (and any rotated
  // derivative) when the file changes or on unmount.
  useEffect(() => {
    const url = URL.createObjectURL(baseFile)
    baseUrlRef.current = url
    workingUrlRef.current = url
    setWorkingUrl(url)
    return () => {
      if (workingUrlRef.current && workingUrlRef.current !== url) {
        URL.revokeObjectURL(workingUrlRef.current)
      }
      URL.revokeObjectURL(url)
    }
  }, [baseFile])

  // Esc cancels (but not while an upload is in flight, to avoid a half state).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  // Clamp an offset so the (cover-or-larger) image always fills the stage —
  // never reveals a gap at the edges of the circle.
  const clamp = useCallback(
    (o: { x: number; y: number }, dw: number, dh: number) => ({
      x: Math.min(0, Math.max(STAGE - dw, o.x)),
      y: Math.min(0, Math.max(STAGE - dh, o.y)),
    }),
    [],
  )

  // Push the current offset + scale onto the <img> imperatively. Called on load,
  // on zoom, and on every drag frame — drag never goes through setState.
  const applyTransform = useCallback(() => {
    const img = imgRef.current
    if (!img || !natural) return
    const scale = baseScale * zoom
    const dw = natural.w * scale
    const dh = natural.h * scale
    offsetRef.current = clamp(offsetRef.current, dw, dh)
    img.style.width = `${dw}px`
    img.style.height = `${dh}px`
    img.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`
  }, [natural, baseScale, zoom, clamp])

  // Re-apply whenever scale changes (zoom slider/buttons, or a fresh image after
  // load/rotate/replace). useLayoutEffect → no flash of the un-positioned image.
  useLayoutEffect(() => {
    applyTransform()
  }, [applyTransform])

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget
    const w = el.naturalWidth
    const h = el.naturalHeight
    if (!w || !h) return
    // Center the freshly loaded image and reset zoom — applyTransform runs via
    // the layout effect once `natural`/`zoom` settle.
    const scale = Math.max(STAGE / w, STAGE / h)
    offsetRef.current = { x: (STAGE - w * scale) / 2, y: (STAGE - h * scale) / 2 }
    setNatural({ w, h })
    setZoom(MIN_ZOOM)
  }

  // ── Drag to reposition ────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    if (busy) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d || !natural) return
    const scale = baseScale * zoom
    offsetRef.current = clamp(
      { x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) },
      natural.w * scale,
      natural.h * scale,
    )
    const img = imgRef.current
    if (img) img.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  // ── Zoom (anchored to the stage center so the crop stays put) ──────────────
  function handleZoom(next: number) {
    if (!natural) return setZoom(next)
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    const s0 = baseScale * zoom
    const s1 = baseScale * nz
    const c = STAGE / 2
    // Natural-space point currently under the stage center stays under it.
    const nx = (c - offsetRef.current.x) / s0
    const ny = (c - offsetRef.current.y) / s0
    offsetRef.current = clamp(
      { x: c - nx * s1, y: c - ny * s1 },
      natural.w * s1,
      natural.h * s1,
    )
    setZoom(nz)
  }

  // ── Rotate 90° CW (optional; baked losslessly to a new PNG blob) ───────────
  async function rotate() {
    const img = imgRef.current
    if (!img || busy) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalHeight
      canvas.height = img.naturalWidth
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('rotate failed')
      const url = URL.createObjectURL(blob)
      // Replace the previous derivative (keep the original base url intact).
      if (workingUrlRef.current && workingUrlRef.current !== baseUrlRef.current) {
        URL.revokeObjectURL(workingUrlRef.current)
      }
      workingUrlRef.current = url
      setWorkingUrl(url) // reloads <img> → onImageLoad recenters & resets zoom
    } catch {
      setError('Could not rotate the image.')
    } finally {
      setBusy(false)
    }
  }

  // ── Replace the picked image ──────────────────────────────────────────────
  function onReplacePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    if (!picked.type.startsWith('image/')) return setError('Please choose an image file.')
    setError(null)
    // The base-url effect handles revoking the old urls when baseFile changes.
    setBaseFile(picked)
  }

  // ── Confirm: rasterise the circle's bounding square and hand it up ─────────
  async function save() {
    const img = imgRef.current
    if (!img || !natural || busy) return
    setBusy(true)
    setError(null)
    try {
      const scale = baseScale * zoom
      // Source rectangle (in the image's natural pixels) under the stage square.
      const srcSize = STAGE / scale
      const srcX = -offsetRef.current.x / scale
      const srcY = -offsetRef.current.y / scale

      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT
      canvas.height = OUTPUT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT)

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
      if (!blob) throw new Error('encode failed')
      const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      await onConfirm(cropped) // parent uploads + closes on success
    } catch {
      // Parent rejected (upload failed) or rasterisation failed — stay open.
      setError('Could not upload the image. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => !busy && onCancel()} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Crop profile photo"
        className="relative w-full max-w-[360px] rounded-modal border border-white/[0.08] bg-surface"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.65)' }}
      >
        <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-[-0.2px]">Crop photo</h2>
            <p className="text-[12px] text-muted mt-0.5">Drag to reposition · zoom to fit</p>
          </div>
          <button
            onClick={() => !busy && onCancel()}
            aria-label="Close"
            className="text-muted hover:text-text transition-colors -mr-1 mt-0.5"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>

        <input
          ref={replaceInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onReplacePicked}
          className="hidden"
        />

        <div className="px-5 py-4">
          {/* Crop stage: the image fills it, a circular mask darkens the corners
              (what gets cut off when shown round), and a faint ring marks the
              final avatar edge. */}
          <div className="flex justify-center">
            <div
              ref={stageRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative overflow-hidden rounded-card bg-bg select-none touch-none cursor-grab active:cursor-grabbing"
              style={{ width: STAGE, height: STAGE }}
            >
              {workingUrl && (
                <img
                  ref={imgRef}
                  src={workingUrl}
                  alt="Crop preview"
                  onLoad={onImageLoad}
                  draggable={false}
                  className="absolute left-0 top-0 max-w-none origin-top-left pointer-events-none"
                />
              )}

              {/* Circular mask: a circle with a huge spread shadow darkens
                  everything outside it, plus a 1px ring for the avatar edge. */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
              />
              <div className="absolute inset-0 rounded-full ring-1 ring-white/20 pointer-events-none" />

              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                  <Loader2 size={22} strokeWidth={2} className="animate-spin text-white/90" />
                </div>
              )}
            </div>
          </div>

          {/* Zoom control: themed slider flanked by icon steppers (no native
              range chrome). */}
          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={() => handleZoom(zoom - 0.25)}
              aria-label="Zoom out"
              disabled={busy}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-btn border border-white/[0.14] text-muted hover:text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              <ZoomOut size={14} strokeWidth={1.8} />
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={busy}
              onChange={(e) => handleZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="flex-1 h-1 cursor-pointer appearance-none bg-transparent disabled:opacity-50
                [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/[0.14]
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/20
                [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/[0.14]
                [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-text"
            />
            <button
              onClick={() => handleZoom(zoom + 0.25)}
              aria-label="Zoom in"
              disabled={busy}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-btn border border-white/[0.14] text-muted hover:text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              <ZoomIn size={14} strokeWidth={1.8} />
            </button>
          </div>

          {/* Secondary actions: rotate + replace. */}
          <div className="mt-3 flex items-center justify-center gap-1.5">
            <button
              onClick={() => void rotate()}
              disabled={busy}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-[11.5px] text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              <RotateCw size={12} strokeWidth={1.8} />
              Rotate
            </button>
            <button
              onClick={() => replaceInputRef.current?.click()}
              disabled={busy}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-[11.5px] text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} strokeWidth={1.8} />
              Replace
            </button>
          </div>

          {error && <div className="text-[11.5px] text-alert text-center mt-3">{error}</div>}
        </div>

        {/* Footer actions. */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="h-9 px-3.5 rounded-btn border border-white/[0.14] text-[12.5px] text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !natural}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-btn bg-text text-bg text-[12.5px] font-semibold hover:bg-text/90 disabled:opacity-60 transition-colors"
          >
            {busy ? (
              <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />
            ) : (
              <Check size={14} strokeWidth={2.2} />
            )}
            Use photo
          </button>
        </div>
      </div>
    </div>
  )
}
