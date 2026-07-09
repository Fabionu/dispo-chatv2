import { useEffect, useRef, useState } from 'react'
import { getPdfThumbnail } from '../../lib/pdfThumbCache'

type Props = {
  attachmentId: string
  url: string
}

// First-page thumbnail layer for the PDF document card. Absolutely fills the
// card's preview band and paints OVER the generic glyph, which stays mounted
// beneath as both the loading placeholder and the hard-failure fallback.
//
// Rendering is visibility-gated: nothing is fetched or rasterised until the
// card nears the viewport (same 200px margin as lazy chat images), and the
// session cache in pdfThumbCache means each attachment renders at most once
// no matter how many times its row remounts. While a render is genuinely in
// flight a faint pulse plays over the band; on failure the layer renders
// nothing and the glyph simply remains.
export default function PdfThumb({ attachmentId, url }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Fade the decoded image in so the glyph→page swap doesn't pop.
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!inView) return
    let cancelled = false
    void getPdfThumbnail(attachmentId, url).then((thumbUrl) => {
      if (cancelled) return
      if (thumbUrl) setSrc(thumbUrl)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [inView, attachmentId, url])

  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none">
      {inView && !src && !failed && (
        <div className="absolute inset-0 bg-white/[0.03] animate-pulse" />
      )}
      {src && (
        <>
          <img
            src={src}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setShown(true)}
            onError={() => {
              setSrc(null)
              setFailed(true)
            }}
            className={`h-full w-full object-cover object-top transition-opacity duration-300 ${
              shown ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {/* Bottom scrim so the corner action icon stays legible on a white
              page (the icon spans render after this layer, so they sit above). */}
          <div className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-black/50 to-transparent" />
        </>
      )}
    </div>
  )
}
