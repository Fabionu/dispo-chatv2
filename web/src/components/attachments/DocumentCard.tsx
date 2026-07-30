import {
  AttachmentGlyphStage,
  AttachmentIdentity,
  AttachmentPreviewFrame,
} from './AttachmentPreviewFrame'

type Props = {
  name: string
  mimeType: string
  byteSize: number
}

// The themed stand-in for a document that has no rendered page — used by the
// in-app document modal and as the PDF renderer's fallback. It is the SAME
// frame + identity pair the send preview uses, so a document looks identical
// wherever it appears: a bounded stage carrying the type glyph, with the
// filename and type · size underneath.
export default function DocumentCard({ name, mimeType, byteSize }: Props) {
  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-3">
      <AttachmentPreviewFrame>
        <AttachmentGlyphStage mimeType={mimeType} />
      </AttachmentPreviewFrame>
      <AttachmentIdentity name={name} mimeType={mimeType} byteSize={byteSize} />
    </div>
  )
}
