import type { Attachment, ReplyToPreview } from '../lib/types'
import type { LocalMessage } from './messages/types'

// Build the compact reply snapshot the composer + bubble render from a message.
export function toReplyPreview(m: LocalMessage): ReplyToPreview {
  return {
    id: m.id,
    authorName: m.authorName,
    body: m.body,
    hasAttachments: (m.attachments?.length ?? 0) > 0,
    deleted: Boolean(m.deletedAt),
  }
}

// Short label for an attachment tab pill: the filename (trimmed), or a generic
// fallback by kind. Kept compact so the tab banner doesn't grow wide.
export function attachmentTabLabel(a: Attachment): string {
  const name = a.originalName?.trim()
  if (name) return name.length > 22 ? `${name.slice(0, 21)}…` : name
  return a.mimeType.startsWith('image/') ? 'Image' : 'Document'
}
