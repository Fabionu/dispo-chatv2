import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import PreviewActionBar from './PreviewActionBar'
import { IconButton } from './IconAction'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Render INLINE inside a chat-window tab instead of as a fullscreen modal: no
  // backdrop, no filename banner (it's in the tab label), no Esc/click-away
  // close — but the full zoom/pan + action bar are kept identical.
  embedded?: boolean
}

const MIN_SCALE = 1
const MAX_SCALE = 6
const WHEEL_STEP = 1.15
const BUTTON_STEP = 1.4
const DOUBLE_CLICK_ZOOM = 2.5

type View = { scale: number; tx: number; ty: number }
const FIT: View = { scale: 1, tx: 0, ty: 0 }

// In-app image lightbox with zoom + bounded pan. The image fits the viewport
// at scale=1; users can zoom (buttons / wheel / double-click) and pan once
// zoomed. Pan is clamped so the image can never be dragged past its own
// edges into the empty area.
export default function ImagePreviewModal({
  attachment,
  message,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
  embedded = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>(FIT)
  const [dragging, setDragging] = useState(false)
  // Captured at mousedown so we can compute drag offsets purely from
  // window-level mousemove events.
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // Reset to fit whenever a new image opens.
  useEffect(() => {
    setView(FIT)
    setNaturalSize({ w: 0, h: 0 })
  }, [attachment.id])

  // Esc closes the modal — only in modal mode. In a tab the × / Close action
  // handles dismissal, and a global Esc would clash with the chat's own handlers.
  useEffect(() => {
    if (embedded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  // Track the live container dimensions so the fit math reacts to viewport /
  // window resizes.
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

  // Size of the image after CSS object-fit: contain, before the user's zoom
  // is applied. This is what scale=1 represents; "scale" multiplies it.
  const fitted = (() => {
    if (!naturalSize.w || !naturalSize.h || !containerSize.w || !containerSize.h) {
      return { w: 0, h: 0 }
    }
    const k = Math.min(
      containerSize.w / naturalSize.w,
      containerSize.h / naturalSize.h,
      1, // never upscale beyond natural at fit
    )
    return { w: naturalSize.w * k, h: naturalSize.h * k }
  })()

  // Bounds-clamped state setter. Whenever scale or translate changes we run
  // this so the image edges can never be pulled past the viewport edges.
  // When the scaled image is smaller than the viewport on an axis, the max
  // offset on that axis is 0 → it stays centered.
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

  // Re-clamp whenever the container or image dimensions change. Prevents the
  // image from being stranded off-screen after a window resize while zoomed.
  useEffect(() => {
    setView((v) => clampView(v))
  }, [clampView])

  // Zoom toward an optional focal point given in container-centered
  // coordinates (0,0 = center; negative is left/up). The point under the
  // cursor stays under the cursor — same trick Figma uses.
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

  // Non-passive wheel listener: React's default wheel event is passive in
  // modern browsers, so preventDefault() would otherwise be a no-op. Pinning
  // a native listener lets us swallow page-scroll while zooming.
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

  // Drag-to-pan. Mousedown captures the starting view; window-level move/up
  // handlers do the work so the cursor can leave the image without ending
  // the drag prematurely.
  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      const d = dragStartRef.current
      if (!d) return
      setView((v) =>
        clampView({
          scale: v.scale,
          tx: d.tx + (e.clientX - d.x),
          ty: d.ty + (e.clientY - d.y),
        }),
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
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={attachment.originalName}
      className={
        embedded
          ? 'flex-1 min-h-0 flex flex-col bg-bg'
          : 'fixed inset-0 z-50 bg-black/85 flex flex-col p-4'
      }
      onClick={embedded ? undefined : onClose}
    >
      {/* Modal-only top bar: filename + in-flow actions. In a tab the filename is
          in the tab label and the actions FLOAT over the image (below), so no
          height is reserved here. */}
      {!embedded && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 shrink-0" onClick={stop}>
          <div className="text-[0.78125rem] text-text truncate flex-1 min-w-0">
            {attachment.originalName}
          </div>
          <PreviewActionBar
            attachment={attachment}
            message={message}
            onReply={onReply}
            onForward={onForward}
            onClose={onClose}
            onOpenInTab={onOpenInTab}
          />
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center select-none"
      >
        {/* Floating action cluster (tab mode) — top-right over the image. The pill
            carries its own dark surface, so it stays readable without any scrim. */}
        {embedded && (
          <PreviewActionBar
            attachment={attachment}
            message={message}
            onReply={onReply}
            onForward={onForward}
            onClose={onClose}
            floating
          />
        )}
        <img
          src={attachment.url}
          alt={attachment.originalName}
          draggable={false}
          onLoad={(e) =>
            setNaturalSize({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
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

        {/* Floating zoom controls — icon-only, themed tooltips. Clicks here
            mustn't close the modal. In a tab they sit on a dark translucent pill
            so they stay readable over a light image. */}
        <div
          onClick={stop}
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 ${
            embedded
              ? 'rounded-full bg-bg/[0.92] px-1 py-0.5 shadow-[0_2px_10px_rgba(0,0,0,0.45)]'
              : ''
          }`}
        >
          <IconButton
            label="Zoom out"
            tooltipSide="top"
            disabled={view.scale <= MIN_SCALE}
            onClick={() => applyZoom(1 / BUTTON_STEP)}
          >
            <ZoomOut size="1.125rem" strokeWidth={1.8} />
          </IconButton>
          <IconButton label="Fit to screen" tooltipSide="top" onClick={() => setView(FIT)}>
            <Maximize size="1.125rem" strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="Zoom in"
            tooltipSide="top"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => applyZoom(BUTTON_STEP)}
          >
            <ZoomIn size="1.125rem" strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
