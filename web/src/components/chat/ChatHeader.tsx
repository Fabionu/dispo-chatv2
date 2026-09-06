import type { RefObject } from 'react'
import { Info, Route, Search, X } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel } from '../../lib/types'
import HeaderIconButton from '../HeaderIconButton'
import { HEADER_TILE_PX, RowTile } from '../../pages/sidebarBits'

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
    /* Thread header — left-aligned identity, actions at the right edge, and a
       single hairline sealing it against the timeline.

       THE PICTURE IS BACK (user, 2026-09-06). It was removed on the argument
       that a thread's identity is its title plus the operational line under it,
       and that a 56px portrait was the largest object on a screen made of
       hairlines. The second half was a complaint about SIZE, and it got
       answered by deleting the thing instead of sizing it: at 42px, next to a
       header that is now tall enough to hold it, the picture is no longer the
       loudest object on the screen. And the rail, the timeline and the Android
       header all show it — the one surface that dropped it was the one place
       you spend the most time, where you would most like to be sure which
       conversation you are typing into.

       Same tile as the rail row, deliberately: vehicle rooms squircle, people
       circle. That shape difference is what tells a room from a DM at a glance,
       and it only works if it is the same object everywhere.

       Height is --header-height, like every other main-pane header and every
       rail panel header. It used to be a hardcoded h-16, which at 1920 drew
       66px against those 58px — so opening Settings beside an open thread put
       two hairlines eight pixels apart across the seam they are documented to
       share. A rem-based height cannot track a token that is a clamp over vw;
       it had to be the token itself.

       The identity takes the flexible width and the actions are a plain flex
       sibling rather than an absolute overlay: with nothing centred there is
       nothing for an expanding search field to shift, so it can simply squeeze
       the title instead of floating over it. */
    <header className="h-[var(--header-height)] flex items-center gap-3 px-5 shrink-0 overflow-hidden border-b">
      {/* Not a button, though the DM title beside it is one. Two adjacent
          controls firing the same action is one tab stop too many and reads
          twice to a screen reader; the picture is here to be recognised, not
          pressed. */}
      <div className="shrink-0">
        {group.type === 'direct' ? (
          <RowTile
            kind="user"
            id={group.directPeer?.id ?? ''}
            name={groupLabel(group)}
            size={HEADER_TILE_PX}
          />
        ) : (
          <RowTile kind="group" id={group.id} hasAvatar={group.hasAvatar} size={HEADER_TILE_PX} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {group.type === 'direct' ? (
          <button
            type="button"
            onClick={() =>
              onOpenProfile(group.directPeer?.id ?? '', group.directPeer?.name ?? groupLabel(group))
            }
            className="block max-w-full text-left text-xl font-semibold tracking-[-0.2px] truncate leading-tight hover:underline underline-offset-4 focus-visible:outline-none focus-visible:underline"
          >
            {groupLabel(group)}
          </button>
        ) : (
          <div className="text-xl font-semibold tracking-[-0.2px] truncate leading-tight">{groupLabel(group)}</div>
        )}
        {/* The operational line — `.eyebrow`, because it is structure rather
            than something somebody said; `text-active` when someone is typing,
            since that IS content arriving. */}
        <div
          role={typingText ? 'status' : undefined}
          aria-live={typingText ? 'polite' : undefined}
          className={`eyebrow truncate leading-tight mt-1 ${typingText ? 'text-active' : ''}`}
        >
          {typingText || subtitle}
        </div>
      </div>

      {/* Search is offered in EVERY conversation (DM + vehicle); Group info
          stays vehicle-only. */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Inline search field — expands to the LEFT of the search button when
            open, so it stays inside the header action area instead of taking a
            full row under the header. A drawn rectangle like every other field
            in the app; a trailing clear (×) appears only with text typed. */}
        {searchOpen && (
          <div
            data-search-region
            className="flex items-center gap-1 h-10 pl-3 pr-1 mr-1.5 border border-strong"
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
              className="w-40 sm:w-52 bg-transparent text-base outline-none placeholder:text-faint"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  onSearchQueryChange('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
                className="rounded-btn h-6 w-6 flex items-center justify-center text-muted hover:text-text hover:bg-white/8 transition-colors shrink-0"
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
          className={`h-10 w-10 flex items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            searchOpen ? 'text-text bg-white/6' : 'text-muted hover:text-text hover:bg-white/6'
          }`}
        >
          <Search size="1.1875rem" strokeWidth={1.8} />
        </button>
        {routeMapAvailable && (
          <HeaderIconButton
            label="Trip route"
            size="lg"
            active={tripRouteActive}
            onClick={() => (tripRouteActive ? onCloseTripRoute() : onOpenTripRoute())}
          >
            <Route size="1.1875rem" strokeWidth={1.8} />
          </HeaderIconButton>
        )}
        {group.type === 'vehicle' && (
          <HeaderIconButton label="Group info" size="lg" onClick={onOpenGroupInfo}>
            <Info size="1.1875rem" strokeWidth={1.8} />
          </HeaderIconButton>
        )}
      </div>
    </header>
  )
}
