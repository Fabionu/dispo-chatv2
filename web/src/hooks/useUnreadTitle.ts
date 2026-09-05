import { useEffect } from 'react'
import type { Group } from '../lib/types'

// The browser tab's unread count.
//
// It is the only unread surface that survives the app being in the background,
// which is the entire case for it: the sidebar badge is invisible behind another
// window, and an OS banner is gone a few seconds after it appears. A title stays
// until someone reads it, and it is the thing a dispatcher actually glances at
// while working in another tab.

const FALLBACK_TITLE = 'Dispo-chat'
// Past this the exact number stops being information and starts being noise.
const MAX_SHOWN = 99

// Captured once, at module load, before anything has written a count. The strip
// is for hot reload: re-evaluating this module with "(3) Dispo-chat" already on
// screen would otherwise bake the count into the base and never let it go.
const BASE_TITLE =
  (typeof document === 'undefined' ? '' : document.title).replace(/^\(\d+\+?\)\s*/, '') ||
  FALLBACK_TITLE

/**
 * Unread messages worth interrupting for.
 *
 * ARCHIVED conversations never count: archiving is the user saying this one is
 * done with.
 *
 * MUTED conversations contribute only their MENTIONS. Mute silences a room, not
 * someone calling your name — and counting a muted vehicle room's whole traffic
 * would leave the tab permanently marked, at which point the number stops
 * meaning "something needs you" and becomes decoration.
 */
export function unreadTitleCount(groups: Group[]): number {
  let total = 0
  for (const group of groups) {
    if (group.archivedAt) continue
    total += (group.muted ? group.unreadMentionCount : group.unreadCount) ?? 0
  }
  return total
}

export function useUnreadTitle(groups: Group[]) {
  const total = unreadTitleCount(groups)
  useEffect(() => {
    document.title =
      total > 0 ? `(${total > MAX_SHOWN ? `${MAX_SHOWN}+` : total}) ${BASE_TITLE}` : BASE_TITLE
    // Restore on unmount so signing out, or any route that drops the workspace,
    // cannot leave a stale count sitting in the tab.
    return () => {
      document.title = BASE_TITLE
    }
  }, [total])
}
