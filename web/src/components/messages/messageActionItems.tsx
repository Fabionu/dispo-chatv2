import {
  Copy,
  Download,
  Forward,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from 'lucide-react'
import type { Attachment } from '../../lib/types'
import { downloadAttachment } from '../attachments/attachmentUtils'
import { type MessageAction } from './MessageActionsMenu'
import type { LocalMessage } from './types'

// Inputs needed to build a message's action-menu items. Kept as a plain params
// object so the builder stays a pure function of the row's computed state +
// callbacks — the exact same list the row rendered inline before this split.
export type MessageActionParams = {
  message: LocalMessage
  pinned: boolean
  canCopy: boolean
  downloadable: Attachment[]
  canMessagePrivately: boolean
  mine: boolean
  canEdit: boolean
  canDeleteForEveryone: boolean
  onCopy: (m: LocalMessage) => void
  onPin: (m: LocalMessage) => void
  onUnpin: (m: LocalMessage) => void
  onReply: (m: LocalMessage) => void
  onEdit: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onReplyPrivately: (m: LocalMessage) => void
  onSendPrivate: (m: LocalMessage) => void
  onDeleteForMe: (m: LocalMessage) => void
  onDeleteForEveryone: (m: LocalMessage) => void
}

// rem so the menu glyphs track the global UI scale (14px design size).
const iconSize = '0.875rem'

// Build the ordered action list for a message's actions menu. Pure — the order,
// labels, disabled/tone/separator flags and click handlers are unchanged from
// the original inline construction in MessageRow.
export function buildMessageActions({
  message,
  pinned,
  canCopy,
  downloadable,
  canMessagePrivately,
  mine,
  canEdit,
  canDeleteForEveryone,
  onCopy,
  onPin,
  onUnpin,
  onReply,
  onEdit,
  onForward,
  onReplyPrivately,
  onSendPrivate,
  onDeleteForMe,
  onDeleteForEveryone,
}: MessageActionParams): MessageAction[] {
  return [
    { label: 'Reply', onClick: () => onReply(message), icon: <Reply size={iconSize} strokeWidth={1.8} /> },
    {
      label: pinned ? 'Unpin message' : 'Pin message',
      onClick: () => (pinned ? onUnpin(message) : onPin(message)),
      icon: pinned ? (
        <PinOff size={iconSize} strokeWidth={1.8} />
      ) : (
        <Pin size={iconSize} strokeWidth={1.8} />
      ),
    },
    {
      label: 'Copy',
      onClick: () => onCopy(message),
      disabled: !canCopy,
      icon: <Copy size={iconSize} strokeWidth={1.8} />,
    },
    { label: 'Forward', onClick: () => onForward(message), icon: <Forward size={iconSize} strokeWidth={1.8} /> },
    // Download sits with Copy/Forward, before the delete group. Only present
    // when the message has at least one server-backed attachment. One file →
    // direct download; multiple → each is downloaded in turn.
    ...(downloadable.length > 0
      ? [
          {
            label: 'Download',
            onClick: () => downloadable.forEach((a) => downloadAttachment(a)),
            icon: <Download size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    ...(canMessagePrivately
      ? [
          {
            label: 'Reply privately',
            onClick: () => onReplyPrivately(message),
            icon: <Reply size={iconSize} strokeWidth={1.8} />,
          },
          {
            label: 'Send private message',
            onClick: () => onSendPrivate(message),
            icon: <MessageCircle size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    ...(mine
      ? [
          {
            label: 'Edit',
            onClick: () => onEdit(message),
            disabled: !canEdit,
            icon: <Pencil size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    {
      label: 'Delete for me',
      onClick: () => onDeleteForMe(message),
      tone: 'alert' as const,
      separator: true,
      icon: <Trash2 size={iconSize} strokeWidth={1.8} />,
    },
    ...(mine
      ? [
          {
            label: 'Delete for everyone',
            onClick: () => onDeleteForEveryone(message),
            disabled: !canDeleteForEveryone,
            tone: 'alert' as const,
            icon: <Trash2 size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
  ]
}
