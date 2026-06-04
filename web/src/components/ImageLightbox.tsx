import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize, X, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from './attachments/IconAction'

type Props = {
  /** Full image URL to display (not the cropped avatar thumbnail). */
  src: string
  /** Accessible label / header title. */
  title: string
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 6
const WHEEL_STEP = 1.15
const BUTTON_STEP = 1.4
const DOUBLE_CLICK_ZOOM = 2.5

type View = { scale: number; tx: number; ty: number }
const FIT: View = { scale: 1, tx: 0, ty: 0 }

// Standalone, theme-matched image lightbox with zoom + bounded pan. Used to view
// avatars / group photos at full size (not the tiny header crop). Self-contained
// — no message/reply/forward coupling — so it can open from anywhere. The image
// fits the viewport at scale=1; zoom via buttons / wheel / double-click and pan
// once zoomed (clamped so it can't be dragged past its own edges). Esc closes.
export default function ImageLightbox({ src, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>(FIT)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setContainerSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitted = (() => {
    if (!naturalSize.w || !naturalSize.h || !containerSize.w || !containerSize.h) {
      return { w: 0, h: 0 }
    }
    const k = Math.min(containerSize.w / naturalSize.w, containerSize.h / naturalSize.h, 1)
    return { w: naturalSize.w * k, h: naturalSize.h * k }
  })()

  const clampView = useCallback(
    (next: View): View => {
      const scaledW = fitted.w * next.scale
      const scaledH = fitted.h * next.scale
      const maxX = Math.max(0, (scaledW - containerSize.w) / 2)
      const maxY = Math.max(0, (scaledH - containerSize.h) / 2)
      return {
        scale: next.scale,
        tx: Math.min(maxX, Math.max(-maxX, next.tx)),
        ty: Math.min(maxY, Math.max(-maxY, next.ty)),
      }
    },
    [fitted.w, fitted.h, containerSize.w, containerSize.h],
  )

  useEffect(() => {
    setView((v) => clampView(v))
  }, [clampView])

  const applyZoom = useCallback(
    (factor: number, focalX = 0, focalY = 0) => {
      setView((v) => {
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
        if (nextScale === v.scale) return v
        const ratio = nextScale / v.scale
        const nextTx = focalX - (focalX - v.tx) * ratio
        const nextTy = focalY - (focalY - v.ty) * ratio
        return clampView({ scale: nextScale, tx: nextTx, ty: nextTy })
      })
    },
    [clampView],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const focalX = e.clientX - rect.left - rect.width / 2
      const focalY = e.clientY - rect.top - rect.height / 2
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
      applyZoom(factor, focalX, focalY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      const d = dragStartRef.current
      if (!d) return
      setView((v) =>
        clampView({ scale: v.scale, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }),
      )
    }
    function onUp() {
      setDragging(false)
      dragStartRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, clampView])

  function onImageMouseDown(e: React.MouseEvent<HTMLImageElement>) {
    if (view.scale <= 1) return
    e.preventDefault()
    e.stopPropagation()
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    setDragging(true)
  }

  function onImageDoubleClick(e: React.MouseEvent<HTMLImageElement>) {
    e.stopPropagation()
    if (view.scale > 1) {
      setView(FIT)
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const focalX = e.clientX - rect.left - rect.width / 2
    const focalY = e.clientY - rect.top - rect.height / 2
    applyZoom(DOUBLE_CLICK_ZOOM, focalX, focalY)
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const canPan = view.scale > 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/85 flex flex-col p-4"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-2 py-1.5" onClick={stop}>
        <div className="text-[12.5px] text-text truncate flex-1 min-w-0">{title}</div>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.8} />
        </IconButton>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center select-none"
      >
        <img
          src={src}
          alt={title}
          draggable={false}
          onLoad={(e) =>
            setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          onMouseDown={onImageMouseDown}
          onDoubleClick={onImageDoubleClick}
          onClick={stop}
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 120ms ease-out',
            cursor: canPan ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            willChange: 'transform',
          }}
          className="max-w-full max-h-full object-contain rounded-card"
        />

        <div onClick={stop} className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          <IconButton
            label="Zoom out"
            tooltipSide="top"
            disabled={view.scale <= MIN_SCALE}
            onClick={() => applyZoom(1 / BUTTON_STEP)}
          >
            <ZoomOut size={15} strokeWidth={1.6} />
          </IconButton>
          <IconButton label="Fit to screen" tooltipSide="top" onClick={() => setView(FIT)}>
            <Maximize size={15} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            label="Zoom in"
            tooltipSide="top"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => applyZoom(BUTTON_STEP)}
          >
            <ZoomIn size={15} strokeWidth={1.6} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
