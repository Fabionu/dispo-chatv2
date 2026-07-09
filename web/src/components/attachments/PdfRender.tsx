import { useEffect, useRef, useState, type ReactNode } from 'react'
import type * as PdfjsModule from 'pdfjs-dist'
import Spinner from '../Spinner'
// Shared lazy pdf.js loader (lib/pdfjs) — one cached module promise across the
// preview surfaces here and the chat-card thumbnails (lib/pdfThumbCache).
import { loadPdfjs } from '../../lib/pdfjs'

// Resolve the document source: a just-picked File (pre-send) becomes raw bytes;
// a sent attachment is a same-origin URL fetched with the session cookie.
type Source = { file?: File; url?: string }

async function getDocParams(src: Source): Promise<Record<string, unknown>> {
  if (src.file) return { data: new Uint8Array(await src.file.arrayBuffer()) }
  return { url: src.url, withCredentials: true }
}

// Crisp-but-bounded device pixel ratio (caps memory on hi-dpi screens).
function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

type PageProps = Source & {
  /** Rendered on a hard failure (corrupt / unsupported / fetch error). */
  fallback: ReactNode
  className?: string
}

// Single-page renderer (page 1) for the pre-send preview. Rasterises page 1 to a
// canvas sized to *contain* it within the available box — no browser PDF chrome,
// no scrollbars. Themed spinner while it loads; on any error it renders the
// caller's fallback (the document card) instead.
export function PdfPagePreview({ file, url, fallback, className = '' }: PageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    let renderTask: ReturnType<PdfjsModule.PDFPageProxy['render']> | null = null
    let doc: PdfjsModule.PDFDocumentProxy | null = null

    async function run() {
      setStatus('loading')
      try {
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        const params = await getDocParams({ file, url })
        if (cancelled) return
        doc = await pdfjs.getDocument(params as Parameters<typeof pdfjs.getDocument>[0]).promise
        if (cancelled) return
        const page = await doc.getPage(1)
        if (cancelled) return

        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return

        const base = page.getViewport({ scale: 1 })
        const cw = container.clientWidth || 600
        const ch = container.clientHeight || 800
        const fit = Math.max(Math.min(cw / base.width, ch / base.height), 0.1)
        const ratio = dpr()
        const viewport = page.getViewport({ scale: fit * ratio })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
        if (cancelled) return
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {
        /* render already settled */
      }
      void doc?.destroy()
    }
  }, [file, url])

  if (status === 'error') return <>{fallback}</>

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full flex items-center justify-center ${className}`}
    >
      <canvas
        ref={canvasRef}
        className={`rounded-card bg-white shadow-[0_8px_30px_rgba(0,0,0,0.5)] ${
          status === 'ready' ? '' : 'invisible'
        }`}
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner label="Rendering preview" />
        </div>
      )}
    </div>
  )
}

// How many pages the in-app viewer rasterises. Bounded so a huge PDF can't pin
// the CPU; past this the user downloads for the full document.
const MAX_PAGES = 30

type DocProps = Source & {
  fallback: ReactNode
  className?: string
}

// Multi-page in-app viewer for a SENT PDF. Renders pages top-to-bottom into a
// themed, vertically-scrollable surface (our scrollbar, not the browser's PDF
// toolbar). Canvases are appended imperatively to a host the React tree leaves
// empty, so React never fights the DOM we mutate. Spinner until page 1 paints;
// fallback on a hard failure.
export function PdfDocumentView({ file, url, fallback, className = '' }: DocProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    let cancelled = false
    let doc: PdfjsModule.PDFDocumentProxy | null = null

    async function run() {
      setStatus('loading')
      setTruncated(false)
      const host = hostRef.current
      if (host) host.replaceChildren()
      try {
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        const params = await getDocParams({ file, url })
        if (cancelled) return
        doc = await pdfjs.getDocument(params as Parameters<typeof pdfjs.getDocument>[0]).promise
        if (cancelled) return

        const total = Math.min(doc.numPages, MAX_PAGES)
        if (doc.numPages > MAX_PAGES) setTruncated(true)

        // Fit each page to the scroll area's width (minus padding), capped so a
        // tiny page isn't upscaled into blur.
        const avail = (scrollRef.current?.clientWidth ?? 880) - 24
        const ratio = dpr()

        for (let n = 1; n <= total; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const fit = Math.max(Math.min(avail / base.width, 1.6), 0.1)
          const viewport = page.getViewport({ scale: fit * ratio })

          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`
          canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
          canvas.className =
            'block mx-auto mb-3 rounded-card bg-white shadow-[0_8px_30px_rgba(0,0,0,0.5)]'

          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('no 2d context')
          await page.render({ canvasContext: ctx, viewport }).promise
          if (cancelled) return
          hostRef.current?.appendChild(canvas)
          // Reveal the surface as soon as the first page is on screen.
          if (n === 1) setStatus('ready')
        }
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
      void doc?.destroy()
    }
  }, [file, url])

  if (status === 'error') {
    return <div className="w-full h-full flex items-center justify-center">{fallback}</div>
  }

  return (
    <div ref={scrollRef} className={`relative w-full h-full overflow-y-auto ${className}`}>
      <div ref={hostRef} className="py-3 px-3" />
      {truncated && status === 'ready' && (
        <div className="pb-4 text-center text-[0.71875rem] text-faint">
          Showing the first {MAX_PAGES} pages — download for the full document.
        </div>
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner label="Rendering document" />
        </div>
      )}
    </div>
  )
}
