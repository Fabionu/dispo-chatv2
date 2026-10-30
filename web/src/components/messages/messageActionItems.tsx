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
import { MENU_GLYPH } from '../menuStyles'
import { type MessageAction } from './MessageActionsPanel'
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

// Build the ordered action list for a message's actions menu. Pure — the order,
// labels, disabled/tone flags and click handlers are unchanged from the
// original inline construction in MessageRow.
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
  // Three groups, in this order (the panel draws a hairline between them):
  // answering or passing the message on, managing it, and deleting it.
  return [
    { label: 'Reply', onClick: () => onReply(message), icon: <Reply {...MENU_GLYPH} />, group: 'respond' },
    { label: 'Forward', onClick: () => onForward(message), icon: <Forward {...MENU_GLYPH} />, group: 'respond' },
    {
      label: 'Copy',
      onClick: () => onCopy(message),
      disabled: !canCopy,
      icon: <Copy {...MENU_GLYPH} />,
      group: 'respond',
    },
    // Download sits with Copy/Forward. Only present when the message has at
    // least one server-backed attachment. One file → direct download; multiple
    // → each is downloaded in turn.
    ...(downloadable.length > 0
      ? [
          {
            label: 'Download',
            onClick: () => downloadable.forEach((a) => downloadAttachment(a)),
            icon: <Download {...MENU_GLYPH} />,
            group: 'respond',
          },
        ]
      : []),
    ...(canMessagePrivately
      ? [
          {
            label: 'Reply privately',
            onClick: () => onReplyPrivately(message),
            icon: <Reply {...MENU_GLYPH} />,
            group: 'respond',
          },
          {
            label: 'Send private message',
            onClick: () => onSendPrivate(message),
            icon: <MessageCircle {...MENU_GLYPH} />,
            group: 'respond',
          },
        ]
      : []),
    {
      label: pinned ? 'Unpin message' : 'Pin message',
      onClick: () => (pinned ? onUnpin(message) : onPin(message)),
      icon: pinned ? (
        <PinOff {...MENU_GLYPH} />
      ) : (
        <Pin {...MENU_GLYPH} />
      ),
      group: 'manage',
    },
    ...(mine
      ? [
          {
            label: 'Edit',
            onClick: () => onEdit(message),
            disabled: !canEdit,
            icon: <Pencil {...MENU_GLYPH} />,
            group: 'manage',
          },
        ]
      : []),
    {
      label: 'Delete for me',
      onClick: () => onDeleteForMe(message),
      tone: 'alert' as const,
      icon: <Trash2 {...MENU_GLYPH} />,
      group: 'danger',
    },
    ...(mine
      ? [
          {
            label: 'Delete for everyone',
            onClick: () => onDeleteForEveryone(message),
            disabled: !canDeleteForEveryone,
            tone: 'alert' as const,
            icon: <Trash2 {...MENU_GLYPH} />,
            group: 'danger',
          },
        ]
      : []),
  ]
}
