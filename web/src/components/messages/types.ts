import type { Message } from '../../lib/types'

// A message that may not have hit the server yet. `localId` is the temporary
// id we render under until the API returns the real message; `pending` /
// `failed` drive the bubble's visual state. `pendingFile` lets the retry
// flow re-upload the same file without forcing the user to re-pick it.
export type LocalMessage = Message & {
  localId?: string
  pending?: boolean
  failed?: boolean
  pendingFile?: File
}
