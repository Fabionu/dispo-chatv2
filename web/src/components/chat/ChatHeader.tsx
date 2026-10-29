import type { RefObject } from 'react'
import { Info, PanelRight, Route, Search, X } from 'lucide-react'
import type { Group } from '../../lib/types'
import { groupLabel, tractorPlate, trailerPlate } from '../../lib/types'
import HeaderIconButton from '../HeaderIconButton'
import { RowMeta, RowTile } from '../../pages/sidebarBits'
import CountryFlag from '../CountryFlag'
import { TONE_TEXT } from '../vehicle/opsControls'
import { placeTown, type TripStop, type TripSummary } from '../../lib/vehicleOps'
import TypingMark from '../messages/TypingMark'

// A DM peer's picture in the one-row header (design px, rendered as rem) — a
// step under the rail's tile so it fits the slim row. Vehicle rooms have none.
const HEADER_TILE_COMPACT_PX = 30

// The header's typing status: the mark, then the sentence. It takes the
// subtitle's place and its voice; the sentence is what truncates, so a narrow
// header never clips the mark.
//
// The copper is set HERE, on the line, and not on the `.eyebrow` that holds it:
// `.eyebrow` declares its own colour and sits later in the sheet than the
// `text-active` utility, so on the same element the faint grey wins — which is
// how the header's typing text came to be grey while its comment said accent.
// A child element has no `.eyebrow` to lose to.
function TypingLine({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-active">
      <TypingMark />
      <span className="truncate">{text}</span>
    </span>
  )
}

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
  // The trip panel beside the thread (vehicle rooms with a trip only).
  tripPanelAvailable: boolean
  tripPanelOpen: boolean
  onToggleTripPanel: () => void
  // Opens the Group-info panel on its Info tab (vehicle rooms only).
  onOpenGroupInfo: () => void
  // The vehicle room's active trip — when present the header grows a second
  // row: the next stop and the final one over the trip's track.
  trip?: TripSummary | null
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
  tripPanelAvailable,
  tripPanelOpen,
  onToggleTripPanel,
  onOpenGroupInfo,
  trip,
}: Props) {
  // LOGBOOK HEADER (rework, 2026-10-10, option C): a vehicle room with a trip
  // names the truck and its order on ONE line, and a second row carries the
  // trip itself. That row replaced the separate trip strip that used to sit
  // under the header — one object at the top of the room instead of two.
  const itinerary = group.type === 'vehicle' && trip && trip.stops.length > 0 ? trip : null
  const orderLine = trip
    ? [trip.reference && `#${trip.reference}`, trip.client].filter(Boolean).join(' ')
    : ''
  // COMPACT ALWAYS (user, 2026-10-29 canvas: "compact the header"): every
  // thread header is one slim row on --tool-header-height now, trip or not, so
  // the controls are always the stepped-down set.
  const compact = true
  const iconSize = compact ? '0.9375rem' : '1.1875rem'
  const iconBox = compact ? 'h-8 w-8' : 'h-10 w-10'
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
    <header className="shrink-0 border-b">
    <div className="h-[var(--tool-header-height)] flex items-center gap-2.5 pl-4 pr-2.5 overflow-hidden">
      {/* A person keeps their picture; a vehicle room has none (user,
          2026-10-29 canvas) — its plate is the identity, as in the rail. Not a
          button, though the DM title beside it is one: two adjacent controls
          firing the same action is one tab stop too many. */}
      {group.type === 'direct' && (
        <div className="shrink-0">
          <RowTile
            kind="user"
            id={group.directPeer?.id ?? ''}
            name={groupLabel(group)}
            hasAvatar={group.directPeer?.hasAvatar}
            version={group.directPeer?.avatarVersion}
            size={HEADER_TILE_COMPACT_PX}
          />
        </div>
      )}

      {/* ONE ROW, always: the title, a short divider, then either the trip
          (near end, track, far end, summary — design canvas option B,
          2026-10-16) or the room's facts in the label voice. Typing takes the
          trip summary's / the facts' place. The trailer │ order │ members facts
          also ride along as the title's tooltip when a trip has the row. */}
      <div className="min-w-0 flex-1 flex items-center gap-2.5">
        {group.type === 'direct' ? (
          <button
            type="button"
            onClick={() =>
              onOpenProfile(group.directPeer?.id ?? '', group.directPeer?.name ?? groupLabel(group))
            }
            className="min-w-0 max-w-[50%] shrink truncate text-left text-[1.0625rem] font-semibold tracking-[-0.2px] leading-tight hover:underline underline-offset-4 focus-visible:outline-none focus-visible:underline"
          >
            {groupLabel(group)}
          </button>
        ) : (
          // A vehicle room's title is its plate, in tabular figures.
          <div
            title={[groupLabel(group), ...subtitle.split(' · '), orderLine].filter(Boolean).join(' · ')}
            className="min-w-0 max-w-[50%] shrink truncate text-[1.0625rem] font-bold tracking-[-0.02em] tabular-nums leading-tight"
          >
            {tractorPlate(group) ?? trailerPlate(group) ?? groupLabel(group)}
          </div>
        )}
        <span aria-hidden className="h-3.5 w-px shrink-0 bg-line" />
        {itinerary ? (
          <TripLine trip={itinerary} typingText={typingText} />
        ) : (
          <div
            role={typingText ? 'status' : undefined}
            aria-live={typingText ? 'polite' : undefined}
            className={`eyebrow min-w-0 flex-1 truncate leading-tight ${typingText ? 'text-active' : ''}`}
          >
            {typingText ? (
              <TypingLine text={typingText} />
            ) : (
              <RowMeta segments={subtitle.split(' · ')} whole />
            )}
          </div>
        )}
      </div>

      {/* Search is offered in EVERY conversation (DM + vehicle); Group info
          stays vehicle-only. */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Inline search field — unfolds to the LEFT of the search button when
            the button is pressed, so it stays inside the header action area
            instead of taking a full row under the header. A drawn, rounded
            field like every other field in the app (`rounded-card`, the field
            step of the radius scale); a trailing clear (×) appears only with
            text typed.

            ALWAYS MOUNTED, revealed by `.chat-search-reveal` (index.css): the
            wrapper is a one-column grid whose track goes 0fr → 1fr, so the
            field grows out of the button and the title beside it reflows with
            the motion instead of jumping to its final width while a fade plays
            over the gap. Closing runs the same track back — the exit no other
            mount/unmount could give without a presence timer — and the
            wrapper's `visibility` flips hidden AFTER the collapse, which is
            what takes the closed input out of the tab order and the
            accessibility tree (a11y needs no React state for it — and no
            aria-hidden, which Chrome would flag while the input still holds
            focus during the collapse). The Animations setting and
            prefers-reduced-motion both zero the transitions, so the field then
            simply appears and disappears. */}
        <div
          data-search-region
          className={`chat-search-reveal ${searchOpen ? 'is-open' : ''}`}
        >
          <div className="min-w-0 overflow-hidden">
            <div className={`flex items-center gap-1 ${compact ? 'h-8' : 'h-10'} pl-3 pr-1 mr-1.5 rounded-card border border-strong`}>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onCloseSearch()
                }}
                placeholder="Search messages…"
                aria-label="Search this conversation"
                tabIndex={searchOpen ? 0 : -1}
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
          </div>
        </div>
        {/* `chat-search-toggle` gives the press itself a beat — a short dip
            on :active — so the button answers the click before the field has
            finished unfolding beside it. */}
        <button
          type="button"
          data-search-region
          aria-label={searchOpen ? 'Close search' : 'Search conversation'}
          aria-pressed={searchOpen}
          title={searchOpen ? 'Close search' : 'Search conversation'}
          onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
          className={`chat-search-toggle ${iconBox} flex items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            searchOpen ? 'text-text bg-white/6' : 'text-muted hover:text-text hover:bg-white/6'
          }`}
        >
          <Search size={iconSize} strokeWidth={1.8} />
        </button>
        {routeMapAvailable && (
          <HeaderIconButton
            label="Trip route"
            size={compact ? 'sm' : 'lg'}
            active={tripRouteActive}
            onClick={() => (tripRouteActive ? onCloseTripRoute() : onOpenTripRoute())}
          >
            <Route size={iconSize} strokeWidth={1.8} />
          </HeaderIconButton>
        )}
        {/* The trip panel's switch is WORDED, not just a glyph: it is the
            one header control that changes the layout, and "Trip" says what
            will appear. Drawn like a control (hairline + 6px), pressed fill
            while the panel is open. */}
        {tripPanelAvailable && (
          <button
            type="button"
            onClick={onToggleTripPanel}
            aria-pressed={tripPanelOpen}
            aria-label={tripPanelOpen ? 'Hide trip panel' : 'Show trip panel'}
            title={tripPanelOpen ? 'Hide trip panel' : 'Show trip panel'}
            className={
              compact
                ? // Glyph only in the one-row layout — the track beside it already
                  // says "trip"; the pressed fill still says the panel is open.
                  `${iconBox} flex items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                    tripPanelOpen ? 'text-text bg-white/6' : 'text-muted hover:text-text hover:bg-white/6'
                  }`
                : `ml-1 h-10 inline-flex items-center gap-2 rounded-btn border px-3.5 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                    tripPanelOpen
                      ? 'border-line bg-white/8 text-text'
                      : 'border-line text-muted hover:text-text hover:bg-white/6'
                  }`
            }
          >
            <PanelRight size={compact ? iconSize : '1rem'} strokeWidth={1.8} />
            {!compact && 'Trip'}
          </button>
        )}
        {group.type === 'vehicle' && (
          <HeaderIconButton label="Group info" size={compact ? 'sm' : 'lg'} onClick={onOpenGroupInfo}>
            <Info size={iconSize} strokeWidth={1.8} />
          </HeaderIconButton>
        )}
      </div>
    </div>
    </header>
  )
}

// "FR 57010 Tremery" → "Tremery": the flag already says the country, and a
// postal code is not what anyone scans a header for.
const town = placeTown

// The header's second row: the stop the truck is heading for on the left, the
// trip's final stop on the right, and the trip drawn as a track under them —
// every stop a mark on it (the map's black-on-white marks; a stop behind the
// truck drops to the hairline grey), the travelled part filled in the status
// colour, and the truck as a dot where it is.
function TripLine({ trip, typingText }: { trip: TripSummary; typingText?: string }) {
  const stops = trip.stops
  const n = stops.length
  const nextIndex = stops.findIndex((s) => s.status === 'planned')
  const lastIndex = n - 1
  // The left label is the stop being driven to — unless that IS the last one
  // (or none is left), in which case it is where the trip began.
  const leftIndex = nextIndex >= 0 && nextIndex < lastIndex ? nextIndex : 0
  const pct = Math.max(0, Math.min(1, trip.progress?.pct ?? 0))
  const at = (i: number) => (n === 1 ? 0 : i / (n - 1))
  const tone = TONE_TEXT[trip.statusTone]

  // The summary after the far end: how far along the truck is (the status word
  // when it has not left or has arrived), then the far stop's ETA / due time.
  // The ends carry the town only; what each end IS (loading, next…) is in its
  // tooltip, and the ring on the track already says which stop is next.
  const far = stops[lastIndex]
  const farWhen = far.eta ? `ETA ${far.eta}` : far.plannedAt
  const pctLabel =
    trip.progress && pct > 0 && pct < 1 ? `${Math.round(pct * 100)}%` : trip.statusLabel

  return (
    <div className="min-w-0 flex flex-1 items-center gap-3">
      <ItineraryEnd stop={stops[leftIndex]} next={leftIndex === nextIndex} />
      <div className={`relative h-3 min-w-16 flex-1 ${tone}`} aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
        <span
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-current"
          style={{ width: `${pct * 100}%` }}
        />
        {stops.map((stop, i) => (
          <span
            key={stop.id}
            className={`absolute top-1/2 box-border h-3 w-3 -translate-y-1/2 rounded-full border-[3px] bg-bg ${
              stop.status === 'done' ? 'border-line-2' : 'border-text'
            }`}
            // Ends sit flush with the row's edges; the rest centre on their mark.
            style={{ left: `calc(${at(i) * 100}% - ${at(i) * 0.75}rem)` }}
          />
        ))}
        {trip.progress && pct > 0 && pct < 1 && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-[3px] ring-bg"
            style={{ left: `${pct * 100}%` }}
          />
        )}
      </div>
      {n > 1 && <ItineraryEnd stop={stops[lastIndex]} next={lastIndex === nextIndex} alignEnd />}
      {typingText ? (
        <span role="status" aria-live="polite" className="max-w-[40%] shrink-0 text-sm font-medium">
          <TypingLine text={typingText} />
        </span>
      ) : (
        <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted">
          <span className={`font-semibold ${tone}`}>{pctLabel}</span>
          {farWhen && ` · ${farWhen}`}
        </span>
      )}
    </div>
  )
}

function ItineraryEnd({ stop, next, alignEnd = false }: { stop: TripStop; next: boolean; alignEnd?: boolean }) {
  // Hover text only: the on-screen line keeps just the town (see TripLine).
  const when = stop.eta ? `ETA ${stop.eta}` : stop.plannedAt
  const role = `${stop.typeLabel}${next ? ', next' : stop.status === 'done' ? ', done' : ''}`
  return (
    <span
      title={`${role}: ${stop.place.text}${when ? `, ${when}` : ''}`}
      className={`flex min-w-0 max-w-[45%] shrink items-center gap-2 ${alignEnd ? 'flex-row-reverse' : ''}`}
    >
      <CountryFlag code={stop.place.code} />
      <span
        className={`truncate text-base font-semibold ${stop.status === 'done' ? 'text-muted' : 'text-text'}`}
      >
        {town(stop.place)}
      </span>
    </span>
  )
}
