import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import DocumentPreviewModal from './DocumentPreviewModal'
import ImagePreviewModal from './ImagePreviewModal'
import InlinePdfPreview from './InlinePdfPreview'

type Props = {
  attachment: Attachment
  message: LocalMessage
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  // Closes THIS attachment tab (the bar's Close action calls it).
  onClose: () => void
}

// An attachment shown as a chat-window tab. Rather than reimplementing the
// preview, it delegates to the SAME components the modal/inline previews use, in
// their `embedded` mode — so the image keeps full zoom/pan, the PDF keeps its
// pdf.js render, and the document keeps its card, all inside the shared preview
// shell: who sent it, the stage, the message it came with, and the action bar
// (Reply/Forward/Download/Close). No "Open in tab" action here — it already is
// one.
export default function AttachmentTabView({
  attachment,
  message,
  currentUserId,
  onReply,
  onForward,
  onClose,
}: Props) {
  const common = { attachment, message, currentUserId, onReply, onForward, onClose, embedded: true }

  if (attachment.mimeType.startsWith('image/')) return <ImagePreviewModal {...common} />
  if (attachment.mimeType === 'application/pdf') return <InlinePdfPreview {...common} />
  return <DocumentPreviewModal {...common} />
}
