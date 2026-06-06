// Left-rail collapsed/expanded preference. Persisted in localStorage (same
// approach as lib/density) so the choice survives reloads. Falls back to
// expanded when storage is unavailable. Desktop-first: callers decide whether to
// honour this on small screens.

const STORAGE_KEY = 'dispo:sidebar-collapsed'

export function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setStoredSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore quota/availability issues — in-memory state still drives the UI */
  }
}
