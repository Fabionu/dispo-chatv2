import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import { AttachmentGlyphStage, AttachmentPreviewFrame } from './AttachmentPreviewFrame'
import AttachmentPreviewShell from './previewChrome'

type Props = {
  attachment: Attachment
  message: LocalMessage
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  onOpenInTab?: () => void
  // Render INLINE inside a chat-window tab instead of as a fullscreen dialog:
  // no Esc / click-away close and no "Open in tab" action, but the same sender
  // header, document card, caption and actions.
  embedded?: boolean
}

// Preview for non-previewable documents (anything that isn't an image or PDF).
// The shared shell carries who sent it and what they said (see previewChrome);
// the stage is the same bounded frame every other attachment surface uses, here
// holding the type glyph and a line saying why there's no page on it. It does
// NOT repeat the filename under the glyph the way DocumentCard does — the shell's
// header already names the file, and printing it twice on one screen reads as a
// bug. Esc and a click on the field around the card both close the fullscreen
// variant — there's nothing to lose here.
export default function DocumentPreviewModal({
  attachment,
  message,
  currentUserId,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
  embedded = false,
}: Props) {
  return (
    <AttachmentPreviewShell
      attachment={attachment}
      message={message}
      currentUserId={currentUserId}
      onReply={onReply}
      onForward={onForward}
      onClose={onClose}
      onOpenInTab={onOpenInTab}
      overlay={!embedded}
      closeOnEsc={!embedded}
    >
      <div className="flex-1 min-h-0 flex items-center justify-center p-4">
        <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[22rem]">
          <AttachmentPreviewFrame>
            <AttachmentGlyphStage
              mimeType={attachment.mimeType}
              note="No in-app preview for this kind of file — download it to open."
            />
          </AttachmentPreviewFrame>
        </div>
      </div>
    </AttachmentPreviewShell>
  )
}
