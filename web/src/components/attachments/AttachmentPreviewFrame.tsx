import type { ReactNode } from 'react'
import { DocIcon, formatBytes, typeLabel } from './attachmentUtils'

// ── The shared preview frame ────────────────────────────────────────────────
// Image previews and document previews are the SAME object: a bounded stage
// with the file's identity underneath it. Only what goes on the stage differs —
// a picture, a rasterised PDF page, or a type glyph. Before this, an image
// preview was a bare <img> filling the screen while a document preview was a
// separate card component with its own band, footer and metrics.
//
// The stage is height-bounded and centres its content, so a 1170×2532
// screenshot and a one-page PDF occupy the same, predictable space and the
// conversation behind the dialog is never pushed around.

export function AttachmentPreviewFrame({
  children,
  /** Fills the stage edge-to-edge (a rasterised PDF page) instead of being
   *  centred inside it with padding (an image, a glyph). */
  bleed = false,
}: {
  children: ReactNode
  bleed?: boolean
}) {
  return (
    <div
      className={`relative flex min-h-[9rem] w-full flex-1 items-center justify-center overflow-hidden rounded-card border border-white/8 bg-bg ${
        bleed ? '' : 'p-2'
      }`}
    >
      {children}
    </div>
  )
}

// The identity line under the stage: name (truncated, full text on hover), then
// type · size. One layout for every file kind.
export function AttachmentIdentity({
  name,
  mimeType,
  byteSize,
  trailing,
}: {
  name: string
  mimeType: string
  byteSize: number
  /** Optional trailing controls (Replace / Remove). */
  trailing?: ReactNode
}) {
  const label = typeLabel(name, mimeType)
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-white/10 bg-white/4">
        <DocIcon mime={mimeType} size={18} className="text-muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-text" title={name}>
          {name}
        </div>
        <div className="mt-0.5 text-sm text-muted tabular-nums">
          {label} · {formatBytes(byteSize)}
        </div>
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>}
    </div>
  )
}

// The glyph stand-in used when there is nothing to render on the stage: a
// document with no thumbnail, or an image whose preview couldn't be generated.
// It fills the stage rather than being a card of its own, so the layout is
// identical whether or not a real preview exists.
export function AttachmentGlyphStage({
  mimeType,
  note,
}: {
  mimeType: string
  /** Why there's no picture — shown quietly under the glyph. */
  note?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-card border border-white/10 bg-white/4">
        <DocIcon mime={mimeType} size={30} className="text-muted" />
      </span>
      {note && <span className="text-sm leading-snug text-faint">{note}</span>}
    </div>
  )
}
