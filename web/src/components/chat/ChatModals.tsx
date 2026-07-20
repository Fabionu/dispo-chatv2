import { lazy, Suspense } from 'react'
import type { Group } from '../../lib/types'
import { groupLabel } from '../../lib/types'
import type { GroupMember } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import type { AttachmentContext } from './chatTypes'
import { ModalLoader } from '../LazyFallback'
import ForwardModal from '../messages/ForwardModal'
import InviteMembersModal from '../invites/InviteMembersModal'
import ConfirmDialog from '../ConfirmDialog'

// Lazy modals — these carry the pdf.js / heavy preview code, so they load only
// when actually opened (same code-splitting as before the extraction).
const ImagePreviewModal = lazy(() => import('../attachments/ImagePreviewModal'))
const AttachmentSendPreviewModal = lazy(() => import('../attachments/AttachmentSendPreviewModal'))
const DocumentPreviewModal = lazy(() => import('../attachments/DocumentPreviewModal'))

// The chat's modal farm, extracted from ChatView: every fixed-position overlay
// that floats above the conversation (pre-send preview, image/document
// lightboxes, forward picker, invite picker, delete confirmation). All state
// stays in ChatView — this component just renders whichever overlay is active.
// The right-hand column panels (Group info, Add trip, profile, receipts) are
// NOT here: they participate in ChatView's flex row, so they must stay inline.
type Props = {
  group: Group
  members: GroupMember[]
  // Pre-send file preview (staged via picker, drag-drop, or paste).
  pendingFile: File | null
  pendingCaption: string
  onReplacePendingFile: (f: File | null) => void
  onCancelPendingFile: () => void
  onSendPendingFile: (caption: string) => void
  // Attachment lightboxes (image + non-previewable document card).
  imagePreview: AttachmentContext | null
  onCloseImagePreview: () => void
  docPreview: AttachmentContext | null
  onCloseDocPreview: () => void
  onReplyFromPreview: (m: LocalMessage) => void
  onForwardFromPreview: (m: LocalMessage) => void
  onOpenAttachmentTab: (ctx: AttachmentContext) => void
  // Forward picker.
  forwardTarget: { message: LocalMessage; groupId: string } | null
  onCloseForward: () => void
  onForwarded: () => void
  // Invite members picker (vehicle groups).
  inviteOpen: boolean
  onCloseInvite: () => void
  // Delete confirmation.
  pendingDelete: { message: LocalMessage; scope: 'me' | 'everyone' } | null
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export default function ChatModals({
  group,
  members,
  pendingFile,
  pendingCaption,
  onReplacePendingFile,
  onCancelPendingFile,
  onSendPendingFile,
  imagePreview,
  onCloseImagePreview,
  docPreview,
  onCloseDocPreview,
  onReplyFromPreview,
  onForwardFromPreview,
  onOpenAttachmentTab,
  forwardTarget,
  onCloseForward,
  onForwarded,
  inviteOpen,
  onCloseInvite,
  pendingDelete,
  onConfirmDelete,
  onCancelDelete,
}: Props) {
  return (
    <>
      {pendingFile && (
        <Suspense fallback={<ModalLoader />}>
        <AttachmentSendPreviewModal
          file={pendingFile}
          initialCaption={pendingCaption}
          onReplace={onReplacePendingFile}
          onCancel={onCancelPendingFile}
          onSend={onSendPendingFile}
        />
        </Suspense>
      )}

      {imagePreview && (
        <Suspense fallback={<ModalLoader />}>
        <ImagePreviewModal
          attachment={imagePreview.attachment}
          message={imagePreview.message}
          onReply={onReplyFromPreview}
          onForward={onForwardFromPreview}
          onClose={onCloseImagePreview}
          onOpenInTab={() => onOpenAttachmentTab(imagePreview)}
        />
        </Suspense>
      )}

      {docPreview && (
        <Suspense fallback={<ModalLoader />}>
        <DocumentPreviewModal
          attachment={docPreview.attachment}
          message={docPreview.message}
          onReply={onReplyFromPreview}
          onForward={onForwardFromPreview}
          onClose={onCloseDocPreview}
          onOpenInTab={() => onOpenAttachmentTab(docPreview)}
        />
        </Suspense>
      )}

      {forwardTarget && (
        <ForwardModal
          fromGroupId={forwardTarget.groupId}
          message={forwardTarget.message}
          onClose={onCloseForward}
          onForwarded={onForwarded}
        />
      )}

      {inviteOpen && (
        <InviteMembersModal
          groupId={group.id}
          groupName={groupLabel(group)}
          existingMemberIds={members.map((m) => m.id)}
          onClose={onCloseInvite}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.scope === 'everyone' ? 'Delete for everyone?' : 'Delete for me?'}
          message={
            pendingDelete.scope === 'everyone'
              ? "This message will be removed for everyone in the conversation. This can't be undone."
              : 'This message will be hidden from your view only. Other members will still see it.'
          }
          confirmLabel={
            pendingDelete.scope === 'everyone' ? 'Delete for everyone' : 'Delete for me'
          }
          tone="alert"
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
    </>
  )
}
