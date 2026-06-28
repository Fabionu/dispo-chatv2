import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentPreviewModal from './DocumentPreviewModal'
import ImagePreviewModal from './ImagePreviewModal'
import InlinePdfPreview from './InlinePdfPreview'

type Props = {
  attachment: Attachment
  message: LocalMessage
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  // Closes THIS attachment tab (the banner × and the bar's Close both call it).
  onClose: () => void
}

// An attachment shown as a chat-window tab. Rather than reimplementing the
// preview, it delegates to the SAME components the modal/inline previews use, in
// their `embedded` mode — so the image keeps full zoom/pan, the PDF keeps its
// pdf.js render, and the document keeps its card, all with the shared action bar
// (Reply/Forward/Download/Close) and WITHOUT the redundant filename banner (the
// name is already in the tab label). No "Open in tab" action here — it already
// is one.
export default function AttachmentTabView({ attachment, message, onReply, onForward, onClose }: Props) {
  const common = { attachment, message, onReply, onForward, onClose, embedded: true }

  if (attachment.mimeType.startsWith('image/')) return <ImagePreviewModal {...common} />
  if (attachment.mimeType === 'application/pdf') return <InlinePdfPreview {...common} />
  return <DocumentPreviewModal {...common} />
}
