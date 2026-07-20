import { DocIcon, formatBytes } from './attachmentUtils'

type Props = {
  name: string
  mimeType: string
  byteSize: number
}

// Derive a short, human type label from the filename extension / mime type.
function typeLabel(name: string, mime: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  if (ext) return ext
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('text/')) return 'TXT'
  return 'FILE'
}

// Large, polished, fully-themed document card used by the pre-send preview and
// the in-app document modal — a deliberate, branded surface rather than an
// iframe or the browser's default file chrome. A tall preview band carries the
// type glyph (and a corner type badge); a footer holds the filename and
// type · size. No first-page render (PDF rasterisation is deferred to avoid a
// heavy pdf.js dependency).
export default function DocumentCard({ name, mimeType, byteSize }: Props) {
  const label = typeLabel(name, mimeType)
  const isPdf = mimeType === 'application/pdf'

  return (
    <div className="w-full max-w-[20rem] rounded-card border border-white/[0.10] bg-surface overflow-hidden">
      {/* Preview band — a themed stand-in for the document page. */}
      <div className="relative h-[12.5rem] bg-bg flex items-center justify-center border-b border-white/[0.06]">
        {/* Subtle paper-sheet motif so it reads as a document, not an empty box. */}
        <div className="absolute inset-0 opacity-[0.04] bg-gradient-to-b from-white to-transparent pointer-events-none" />
        <div className="h-20 w-20 rounded-card border border-white/[0.10] bg-white/[0.03] flex items-center justify-center">
          <DocIcon mime={mimeType} size={38} className="text-muted" />
        </div>
        <span className="absolute top-2.5 left-2.5 rounded-chip border border-pure-white/10 bg-black/40 px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide text-pure-white/80">
          {isPdf ? 'PDF' : label}
        </span>
      </div>
      {/* Footer — filename + type · size. */}
      <div className="px-4 py-3">
        <div className="text-[0.8125rem] text-text font-medium truncate">{name}</div>
        <div className="text-[0.71875rem] text-muted mt-0.5">
          {label} · {formatBytes(byteSize)}
        </div>
      </div>
    </div>
  )
}
