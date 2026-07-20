import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'

// An attachment paired with the message it belongs to — the context every
// preview surface needs so Reply/Forward operate on the message. Shared by
// ChatView (owner of the preview state) and the extracted chat pieces.
export type AttachmentContext = { attachment: Attachment; message: LocalMessage }
