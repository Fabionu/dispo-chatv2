import Spinner from './Spinner'

// Compact, dark-theme loading placeholders shown while a code-split chunk (a
// heavy panel / modal / preview / map) is fetched. Deliberately minimal — a
// small spinner, no oversized cards — so lazy-loading a feature never flashes a
// heavy loader. Used by ChatView and InboxView around their React.lazy
// boundaries; see those files for which surface each one guards.

// Fills the available area (chat pane, map, attachment preview). Pass a sizing
// className (e.g. "flex-1" or "h-full") to match the slot it replaces.
export function PaneLoader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Spinner variant="sm" />
    </div>
  )
}

// Modal overlay slot: the same dim backdrop the real modals use with a small
// centered spinner, so opening a lazy modal fades in smoothly.
export function ModalLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Spinner variant="sm" />
    </div>
  )
}

// Right-hand side-panel slot (Group info / Add trip). Mirrors the real panel's
// column width + rail background so the chat reflows once (not twice) as the
// panel swaps in.
export function PanelLoader() {
  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] bg-rail flex items-center justify-center
                 xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:rounded-[0.6875rem]"
    >
      <Spinner variant="sm" />
    </div>
  )
}
