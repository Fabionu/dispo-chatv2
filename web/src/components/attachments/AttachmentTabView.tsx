import { FileText, Image as ImageIcon } from 'lucide-react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentCard from './DocumentCard'
import PreviewActionBar from './PreviewActionBar'
import { PdfDocumentView } from './PdfRender'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  // Closes THIS attachment tab (the banner × and the bar's Close both call it).
  onClose: () => void
}

// Inline attachment preview rendered as a chat-window tab (not a modal): an
// image fitted to the area, a PDF rendered by pdf.js, or a themed document card.
// Reuses the shared PreviewActionBar so Reply/Forward/Download/Close behave
// exactly as in the modal previews — minus the "Open in tab" action, since this
// already IS the tab. Mirrors InlinePdfPreview's themed top bar so the two read
// as one system.
export default function AttachmentTabView({ attachment, message, onReply, onForward, onClose }: Props) {
  const isImage = attachment.mimeType.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf'

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-12 flex items-center justify-between gap-3 px-4 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isImage ? (
            <ImageIcon size={15} strokeWidth={1.6} className="text-muted shrink-0" />
          ) : (
            <FileText size={15} strokeWidth={1.6} className="text-muted shrink-0" />
          )}
          <div className="text-[12.5px] text-text truncate min-w-0">{attachment.originalName}</div>
        </div>
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
        />
      </div>

      <div className="flex-1 min-h-0 bg-bg p-3">
        {isImage ? (
          <div className="h-full w-full flex items-center justify-center">
            <img
              src={attachment.url}
              alt={attachment.originalName}
              className="max-h-full max-w-full object-contain rounded-card"
            />
          </div>
        ) : isPdf ? (
          <div className="mx-auto h-full w-full max-w-[900px] rounded-card border border-white/[0.08] overflow-hidden bg-bg">
            <PdfDocumentView
              url={attachment.url}
              fallback={
                <DocumentCard
                  name={attachment.originalName}
                  mimeType={attachment.mimeType}
                  byteSize={attachment.byteSize}
                />
              }
            />
          </div>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <DocumentCard
              name={attachment.originalName}
              mimeType={attachment.mimeType}
              byteSize={attachment.byteSize}
            />
          </div>
        )}
      </div>
    </div>
  )
}
