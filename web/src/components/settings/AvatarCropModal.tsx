import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Loader2, Minus, Plus, RefreshCw, RotateCw, X } from 'lucide-react'

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

// Output is a square raster — stored square, displayed round (matches WhatsApp
// and our <Avatar>, which masks with rounded-full). 512px keeps it crisp on
// retina at every place we render an avatar.
const OUTPUT = 512
// zoom=1 is the "fit/cover" boundary (image just covers the circular crop with
// no transparent gaps); the user can zoom in for a tighter crop up to MAX_ZOOM.
const MIN_ZOOM = 1
const MAX_ZOOM = 5
// Largest stage edge in CSS px (desktop). The stage shrinks responsively to the
// modal width on smaller screens; the crop math reads its MEASURED size, so the
// output is identical regardless of the rendered size.
const STAGE_MAX = 380
const WHEEL_STEP = 1.12

// WhatsApp-style avatar cropper. After picking an image the user repositions
// (drag), zooms (slider / buttons / mouse wheel) and optionally rotates it
// inside a circular mask; only on confirm do we rasterise the selected square
// and upload it. A custom canvas cropper (no dependency): the live preview is a
// GPU-transformed <img> (smooth even for large photos — drag mutates the
// transform imperatively, never through React state), and the final crop is
// drawn once to an offscreen canvas. The stage is responsive: its pixel size is
// measured, so zoom/pan/clamp/output all stay exact at any size.
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
  // Measured stage edge in CSS px (square). 0 until the first layout measure.
  const [stage, setStage] = useState(0)

  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  // Image top-left offset relative to the stage, in CSS px. Source of truth for
  // position — kept in a ref so dragging doesn't trigger React re-renders.
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  // Refs mirroring state so the (stably-bound) wheel handler reads live values
  // without re-binding the native listener on every change.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const naturalRef = useRef(natural)
  naturalRef.current = natural
  const stageRef2 = useRef(stage)
  stageRef2.current = stage
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Always-current `save`, so the Enter-to-confirm listener (bound once) never
  // captures a stale zoom/offset.
  const saveRef = useRef<() => void>(() => {})

  // Smallest scale that still covers the square/circle (no gaps). zoom multiplies
  // this, so zoom=1 is "cover" and the image can only get larger from there.
  const baseScale = natural && stage ? Math.max(stage / natural.w, stage / natural.h) : 1

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
    (o: { x: number; y: number }, dw: number, dh: number, s: number) => ({
      x: Math.min(0, Math.max(s - dw, o.x)),
      y: Math.min(0, Math.max(s - dh, o.y)),
    }),
    [],
  )

  // Push the current offset + scale onto the <img> imperatively. Called on load,
  // on zoom, on resize, and on every drag frame — drag never goes through state.
  const applyTransform = useCallback(() => {
    const img = imgRef.current
    if (!img || !natural || !stage) return
    const scale = baseScale * zoom
    const dw = natural.w * scale
    const dh = natural.h * scale
    offsetRef.current = clamp(offsetRef.current, dw, dh, stage)
    img.style.width = `${dw}px`
    img.style.height = `${dh}px`
    img.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`
  }, [natural, baseScale, zoom, stage, clamp])

  // Re-apply whenever scale/stage changes. useLayoutEffect → no flash of the
  // un-positioned image.
  useLayoutEffect(() => {
    applyTransform()
  }, [applyTransform])

  // Measure the responsive stage and keep it in sync with the modal width. On a
  // size change we re-center the current view so the image still covers.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const s = Math.round(el.clientWidth)
      if (!s || s === stageRef2.current) return
      stageRef2.current = s
      const nat = naturalRef.current
      if (nat) {
        const sc = Math.max(s / nat.w, s / nat.h) * zoomRef.current
        offsetRef.current = { x: (s - nat.w * sc) / 2, y: (s - nat.h * sc) / 2 }
      }
      setStage(s)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget
    const w = el.naturalWidth
    const h = el.naturalHeight
    if (!w || !h) return
    // Center the freshly loaded image and reset zoom — applyTransform runs via
    // the layout effect once `natural`/`zoom` settle. Use the measured stage.
    const s = stageRef2.current || STAGE_MAX
    const scale = Math.max(s / w, s / h)
    offsetRef.current = { x: (s - w * scale) / 2, y: (s - h * scale) / 2 }
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
    if (!d || !natural || !stage) return
    const scale = baseScale * zoom
    offsetRef.current = clamp(
      { x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) },
      natural.w * scale,
      natural.h * scale,
      stage,
    )
    const img = imgRef.current
    if (img) img.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  // ── Zoom, anchored to a focal point (stage-px). Slider/buttons anchor to the
  // centre; the wheel anchors to the cursor so the point under it stays put. ──
  const zoomToward = useCallback((nextZoom: number, fx: number, fy: number) => {
    const nat = naturalRef.current
    const s = stageRef2.current
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    if (!nat || !s) {
      zoomRef.current = nz
      setZoom(nz)
      return
    }
    const bs = Math.max(s / nat.w, s / nat.h)
    const s0 = bs * zoomRef.current
    const s1 = bs * nz
    const nx = (fx - offsetRef.current.x) / s0
    const ny = (fy - offsetRef.current.y) / s0
    offsetRef.current = {
      x: Math.min(0, Math.max(s - nat.w * s1, fx - nx * s1)),
      y: Math.min(0, Math.max(s - nat.h * s1, fy - ny * s1)),
    }
    zoomRef.current = nz
    setZoom(nz)
  }, [])

  // Slider / +/- buttons: zoom about the stage centre.
  const handleZoom = useCallback(
    (next: number) => {
      const s = stageRef2.current || 0
      zoomToward(next, s / 2, s / 2)
    },
    [zoomToward],
  )

  // Mouse-wheel zoom over the stage. Non-passive so we can preventDefault and
  // stop the page/modal from scrolling while zooming. Bound once; reads live
  // values from refs. Up = zoom in, down = zoom out.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (busyRef.current) return
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const fx = e.clientX - rect.left
      const fy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
      zoomToward(zoomRef.current * factor, fx, fy)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomToward])

  // Enter confirms (when an image is ready and we're idle) — unless focus is on
  // a button, where Enter should activate that control instead. Bound once;
  // reads live values from refs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === 'Enter' &&
        !busyRef.current &&
        naturalRef.current &&
        !(e.target instanceof HTMLButtonElement)
      ) {
        e.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    if (!img || !natural || !stage || busy) return
    setBusy(true)
    setError(null)
    try {
      const scale = baseScale * zoom
      // Source rectangle (in the image's natural pixels) under the stage square.
      const srcSize = stage / scale
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
  saveRef.current = save

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75" onClick={() => !busy && onCancel()} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Crop photo"
        className="relative w-full max-w-[28.75rem] rounded-modal border border-white/[0.08] bg-surface overflow-hidden"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.65)' }}
      >
        {/* Header: close (left) · helper title (centre) · replace + rotate
            (right). Slim, no separator. */}
        <header className="flex items-center gap-2 px-2.5 py-2">
          <IconBtn label="Close" side="bottom" onClick={() => !busy && onCancel()}>
            <X size="1.0625rem" strokeWidth={1.8} />
          </IconBtn>
          <div className="flex-1 min-w-0 text-center">
            <span className="text-[0.78125rem] text-muted">Drag image to adjust</span>
          </div>
          <IconBtn label="Rotate" side="bottom" onClick={() => void rotate()} disabled={busy}>
            <RotateCw size="1rem" strokeWidth={1.7} />
          </IconBtn>
          <IconBtn
            label="Replace photo"
            side="bottom"
            onClick={() => replaceInputRef.current?.click()}
            disabled={busy}
          >
            <RefreshCw size="1rem" strokeWidth={1.7} />
          </IconBtn>
        </header>

        <input
          ref={replaceInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onReplacePicked}
          className="hidden"
        />

        {/* Editor stage — the dominant element. The image fills it; a soft dim +
            subtle ring mark the circular crop. Zoom controls and the confirm
            button float over it. On a near-black bed so the photo reads clean. */}
        <div className="relative bg-bg">
          <div
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative w-full mx-auto overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing"
            style={{ maxWidth: STAGE_MAX, aspectRatio: '1 / 1', maxHeight: '70vh' }}
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

            {/* Circular guide: soft dim outside + subtle edge ring. */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
            />
            <div className="absolute inset-0 rounded-full ring-1 ring-white/15 pointer-events-none" />

            {/* Floating vertical zoom controls (right). stopPropagation so using
                them never starts an image drag. */}
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <IconBtn
                label="Zoom in"
                side="left"
                variant="float"
                onClick={() => handleZoom(zoom + 0.25)}
                disabled={busy}
              >
                <Plus size="1rem" strokeWidth={2} />
              </IconBtn>
              <IconBtn
                label="Zoom out"
                side="left"
                variant="float"
                onClick={() => handleZoom(zoom - 0.25)}
                disabled={busy}
              >
                <Minus size="1rem" strokeWidth={2} />
              </IconBtn>
            </div>

            {/* Floating primary confirm (bottom-right), warm accent. */}
            <div
              className="absolute bottom-3 right-3"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <IconBtn
                label="Use photo"
                side="top"
                variant="accent"
                onClick={() => void save()}
                disabled={busy || !natural}
              >
                {busy ? (
                  <Loader2 size="1.25rem" strokeWidth={2.2} className="animate-spin" />
                ) : (
                  <Check size="1.25rem" strokeWidth={2.4} />
                )}
              </IconBtn>
            </div>

            {/* Hidden range kept for assistive tech / sliders, synced with the
                buttons + wheel; visually replaced by the floating controls. */}
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={busy}
              onChange={(e) => handleZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="sr-only"
            />
          </div>
        </div>

        {error && (
          <div className="text-[0.71875rem] text-alert text-center px-4 py-2 bg-bg">{error}</div>
        )}
      </div>
    </div>
  )
}

// Icon-only button with a themed (non-native) hover/focus tooltip. Variants:
//   ghost  — quiet header control
//   float  — translucent dark pill floating over the image (zoom)
//   accent — warm-accent primary confirm
function IconBtn({
  label,
  onClick,
  disabled,
  side = 'bottom',
  variant = 'ghost',
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left'
  variant?: 'ghost' | 'float' | 'accent'
  children: React.ReactNode
}) {
  const styles =
    variant === 'accent'
      ? 'h-12 w-12 rounded-full bg-active text-bg shadow-[0_8px_24px_rgba(0,0,0,0.45)] hover:bg-active/90 focus-visible:ring-2 focus-visible:ring-active/60 disabled:opacity-60'
      : variant === 'float'
        ? 'h-9 w-9 rounded-full bg-black/45 backdrop-blur border border-pure-white/10 text-pure-white hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-pure-white/40 disabled:opacity-40'
        : 'h-8 w-8 rounded-full text-muted hover:text-text hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40 disabled:hover:bg-transparent'

  const tip =
    side === 'top'
      ? 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2'
      : side === 'left'
        ? 'right-[calc(100%+6px)] top-1/2 -translate-y-1/2'
        : 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2'

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`inline-flex items-center justify-center transition-colors focus:outline-none ${styles}`}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-chip border border-white/[0.10] bg-surface px-2 py-1 text-[0.6875rem] text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100 ${tip}`}
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.55)' }}
      >
        {label}
      </span>
    </span>
  )
}
