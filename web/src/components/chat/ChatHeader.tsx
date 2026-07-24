import type { RefObject } from 'react'
import { Info, Route, Search, X } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel } from '../../lib/types'
import Avatar from '../Avatar'
import GroupAvatar from '../GroupAvatar'
import HeaderIconButton from '../HeaderIconButton'

// The conversation header extracted from ChatView. Purely presentational: all
// state (search text/open, trip-route tab, panel opening) is owned by ChatView
// and driven through props, so this component has no behavior of its own.
type Props = {
  group: Group
  // Precomputed one-line subtitle (trailer/member count for vehicles, the
  // peer's workspace for DMs) — derived in ChatView where the data lives.
  subtitle: string
  typingText?: string
  onOpenProfile: (userId: string, name: string) => void
  // Inline search field. The input ref is owned by ChatView so openSearch can
  // focus it after mount.
  searchOpen: boolean
  searchQuery: string
  searchInputRef: RefObject<HTMLInputElement>
  onSearchQueryChange: (q: string) => void
  onOpenSearch: () => void
  onCloseSearch: () => void
  // "Trip route" tab toggle (vehicle rooms with a routable trip only).
  routeMapAvailable: boolean
  tripRouteActive: boolean
  onOpenTripRoute: () => void
  onCloseTripRoute: () => void
  // Opens the Group-info panel on its Info tab (vehicle rooms only).
  onOpenGroupInfo: () => void
}

export default function ChatHeader({
  group,
  subtitle,
  typingText,
  onOpenProfile,
  searchOpen,
  searchQuery,
  searchInputRef,
  onSearchQueryChange,
  onOpenSearch,
  onCloseSearch,
  routeMapAvailable,
  tripRouteActive,
  onOpenTripRoute,
  onCloseTripRoute,
  onOpenGroupInfo,
}: Props) {
  return (
    /* Header stays flat inside the chat card, so the conversation identity
       reads as part of the timeline rather than a nested panel. SLIM by
       design: a fixed compact height
       (smaller than the shared --header-height used by the sidebar seam, which
       we intentionally don't touch) gives the message area more room. The
       identity (avatar + name + trip/subtitle) is LEFT-ALIGNED at the start of
       the header; `pr-24` reserves room for the search / group-info actions
       floated at the right edge so a long title/place never runs under them.
       Same structure for every type (DM + vehicle). The message column's own
       centering (`.chat-column`) is separate and unaffected. */
    <header className="relative h-16 flex items-center gap-2 px-4 shrink-0 overflow-hidden">
      {/* LEFT spacer — balances the right-edge actions so the identity cluster
          stays centred. The active-trip context (status, route, progress) now
          lives in its OWN bar directly under the header (see TripBar in
          ChatView), never crammed into this corner. */}
      <div className="flex-1 min-w-0" />

      {/* CENTER — group identity (avatar + name + subtitle), centered between
          the left banner and the right actions. Unchanged for DMs and vehicles;
          the trip details live in the left banner, never on the title row. */}
      <div className="flex items-center gap-3 min-w-0">
        {group.type === 'direct' ? (
          // The peer's avatar opens their read-only profile panel (DMs show
          // no per-message avatars, so the header is the DM's avatar surface).
          <button
            type="button"
            onClick={() =>
              onOpenProfile(group.directPeer?.id ?? '', group.directPeer?.name ?? groupLabel(group))
            }
            aria-label={`View ${group.directPeer?.name ?? 'user'}'s profile`}
            title={group.directPeer?.name ?? undefined}
            className="block shrink-0 rounded-full cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Avatar
              userId={group.directPeer?.id ?? ''}
              name={group.directPeer?.name ?? groupLabel(group)}
              size={56}
            />
          </button>
        ) : (
          // Vehicle identity — the group's uploaded image when set, else the
          // generated generic icon. A rounded-square slot (vs the DM circle) so
          // a room reads as a room by shape, matching the sidebar + Group info.
          <GroupAvatar groupId={group.id} hasAvatar={Boolean(group.hasAvatar)} shape="rounded" size={56} />
        )}
        <div className="min-w-0">
          {group.type === 'direct' ? (
            <button
              type="button"
              onClick={() =>
                onOpenProfile(group.directPeer?.id ?? '', group.directPeer?.name ?? groupLabel(group))
              }
              className="block max-w-full text-left text-[1rem] font-semibold truncate leading-tight hover:underline underline-offset-2 focus-visible:outline-none focus-visible:underline"
            >
              {groupLabel(group)}
            </button>
          ) : (
            <div className="text-[1rem] font-semibold truncate leading-tight">{groupLabel(group)}</div>
          )}
          <div
            role={typingText ? 'status' : undefined}
            aria-live={typingText ? 'polite' : undefined}
            className={`text-[0.8125rem] truncate leading-tight mt-0.5 ${typingText ? 'text-active font-medium' : 'text-muted'}`}
          >
            {typingText || subtitle}
          </div>
        </div>
      </div>

      {/* RIGHT — spacer that balances the centre column; the search / group-info
          actions below float over it (absolute) so the search field can expand
          without shifting the centered identity. */}
      <div className="flex-1 min-w-0" />
      {/* Borderless toolbar-style actions floated at the right edge so the
          identity cluster stays centered. Search is offered in EVERY
          conversation (DM + vehicle); Group info stays vehicle-only. Same
          circular hover wash + on-theme focus ring for both. */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        {/* Inline search field — expands to the LEFT of the search button when
            open, so it stays inside the header action area instead of taking a
            full row under the header. Compact borderless pill on the dark
            theme; a leading clear (×) appears only with text typed. */}
        {searchOpen && (
          <div
            data-search-region
            className="flex items-center gap-1 h-9 pl-3 pr-1 mr-0.5 rounded-full border border-white/[0.14] bg-surface-2/80 focus-within:border-white/[0.24]"
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCloseSearch()
              }}
              placeholder="Search messages…"
              aria-label="Search this conversation"
              className="w-40 sm:w-52 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  onSearchQueryChange('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
                className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.08] transition-colors shrink-0"
              >
                <X size="0.875rem" strokeWidth={2} />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          data-search-region
          aria-label={searchOpen ? 'Close search' : 'Search conversation'}
          aria-pressed={searchOpen}
          title={searchOpen ? 'Close search' : 'Search conversation'}
          onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
          className={`h-9 px-2.5 flex items-center justify-center gap-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            searchOpen
              ? 'text-text bg-white/[0.06]'
              : 'text-muted hover:text-text hover:bg-white/[0.05]'
          }`}
        >
          <Search size="1.1875rem" strokeWidth={1.8} />
          <span className={`${searchOpen ? 'hidden' : 'hidden sm:inline'} text-[0.75rem] font-medium`}>
            Search
          </span>
        </button>
        {routeMapAvailable && (
          <HeaderIconButton
            label="Trip route"
            active={tripRouteActive}
            onClick={() => (tripRouteActive ? onCloseTripRoute() : onOpenTripRoute())}
          >
            <Route size="1.1875rem" strokeWidth={1.8} />
          </HeaderIconButton>
        )}
        {group.type === 'vehicle' && (
          <HeaderIconButton label="Group info" onClick={onOpenGroupInfo}>
            <Info size="1.25rem" strokeWidth={1.8} />
          </HeaderIconButton>
        )}
      </div>
    </header>
  )
}
