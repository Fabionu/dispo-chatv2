import { loadGoogle } from './loadGoogle'
import { api } from '../api'
import type { HerePlace } from '../here/types'
import type { MapViewport } from '../../components/map/mapProps'

// Address / place autocomplete for every search field in the app, backed by
// Google Places (the "New" Places library of the Maps JS API), with HERE
// Discover as the fallback.
//
// WHY GOOGLE. The map people look at is Google's (see components/map/MapView),
// and the results they are used to — the business names, the exact spellings,
// the "did you mean" tolerance — are Google's too. HERE Discover is a fine
// geocoder but a poor autocomplete: it needs three characters, knows fewer
// businesses, and does not rank by what people actually type. The ROUTE is
// still HERE's (truck profile, restrictions, snap); only the search box moved.
//
// WHY A FALLBACK. Places is a separate API on the same key, enabled per
// project in the Cloud console. A key without it, or an environment without a
// key at all (`VITE_GOOGLE_MAPS_KEY` unset), must not turn every search field
// into a dead input. A failure that says Google CANNOT serve here (API not
// enabled, key refused) flips this module to HERE for the rest of the page's
// life — one warning in the console, not one per keystroke. Any other failure
// (a rate limit, a network blip, a request Google rejected) falls back for
// THAT query only and Google is tried again on the next keystroke: the first
// version flipped permanently on everything, and one malformed request at
// zoom 5 silently turned the app into a HERE-search app until reload.
//
// BILLING SHAPE. Autocomplete is priced per SESSION when the keystrokes and the
// final pick share a session token, and per request when they do not. So a
// field creates one `PlaceSession` when the user starts typing, threads it
// through every suggestion request, and the pick's `fetchFields` (which Google
// ties to the token automatically) closes it. The pick asks for `location`,
// `viewport` and `formattedAddress` only — all in the cheapest details tier;
// `displayName` is a tier up and the prediction's own text already carries the
// name. The viewport is what lets the map frame the place at the right size.

export type PlaceSuggestion = {
  id: string
  /** The name or street line — what the row leads with. */
  title: string
  /** Locality / region, the row's second line. Empty for a bare coordinate. */
  subtitle: string
  /** The one-line address, as a committed point shows it. */
  label: string
  /**
   * Geocode the suggestion. Google predictions carry no coordinate until they
   * are picked (one Place Details call, made here); HERE results already have
   * theirs and resolve immediately. Callers show a brief pending state.
   */
  resolve: () => Promise<HerePlace>
}

/**
 * One lookup, from the first keystroke to the pick. Create it when a field's
 * query goes from empty to non-empty, pass it to every `suggestPlaces` call,
 * and drop it once a suggestion has been resolved — the token is spent then.
 */
export type PlaceSession = {
  token?: google.maps.places.AutocompleteSessionToken
}

export function newPlaceSession(): PlaceSession {
  return {}
}

type PlacesLib = typeof google.maps.places

let placesLibPromise: Promise<PlacesLib | null> | null = null
let placesBroken = false

// The Places namespace, or null when Google cannot serve searches here. Cached:
// the outcome does not change within a page load, and the field asks on every
// debounced keystroke.
function placesLib(): Promise<PlacesLib | null> {
  if (placesBroken) return Promise.resolve(null)
  if (!placesLibPromise) {
    placesLibPromise = loadGoogle()
      .then((g) => g.maps.places ?? null)
      .catch(() => null)
  }
  return placesLibPromise
}

// Google's Maps JS errors are plain Errors whose message carries the reason;
// these are the ones that will not get better by asking again.
function isPermanentPlacesFailure(err: unknown): boolean {
  const message = String((err as { message?: unknown })?.message ?? err)
  return /not authorized|not activated|ApiNotActivated|RefererNotAllowed|InvalidKey|API key|billing/i.test(message)
}

const warned = new Set<string>()
function reportPlacesFailure(err: unknown) {
  if (isPermanentPlacesFailure(err)) {
    if (placesBroken) return
    placesBroken = true
    // eslint-disable-next-line no-console
    console.warn('Google Places is unavailable — search fields are falling back to HERE.', err)
    return
  }
  const key = String((err as { message?: unknown })?.message ?? err)
  if (warned.has(key)) return
  warned.add(key)
  // eslint-disable-next-line no-console
  console.warn('Google Places request failed — this search fell back to HERE.', err)
}

// Ground metres in one screen pixel at a Web-Mercator zoom and latitude — the
// same figure hereMapUtils uses for the snap ring, repeated here rather than
// exported so lib/ does not import from components/.
function metresPerPixel(lat: number, zoom: number): number {
  return Math.max(0.01, (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom)
}

// Prefer results near what the map is showing. A dispatcher zoomed in on
// Rotterdam typing "Hafen" means the one in front of them, not Hamburg's. A
// circle roughly the width of the view, clamped at both ends: a street-level
// view does not exclude the next town, and a country-level view is capped at
// Google's own limit — a circle bias may be at most 50 km (larger threw
// "Invalid circle.radius" and took Google search down for the whole page).
// Bias, never restriction: the far result is still there, just lower.
const BIAS_RADIUS_MIN_M = 2_000
const BIAS_RADIUS_MAX_M = 50_000

function biasFor(view: MapViewport | null | undefined): google.maps.places.LocationBias | undefined {
  if (!view) return undefined
  const radius = Math.min(BIAS_RADIUS_MAX_M, Math.max(BIAS_RADIUS_MIN_M, metresPerPixel(view.center.lat, view.zoom) * 400))
  return { center: view.center, radius }
}

// Businesses lead with their name, then the address; a plain address or a town
// IS its formatted address. Telling the two apart by the prediction's types
// (rather than by string-prefix tricks) is what stops "Bahnhofplatz 2" from
// becoming "Bahnhofplatz 2, Bahnhofpl. 2, …" when Google abbreviates the street.
function isEstablishment(types: string[]): boolean {
  return types.includes('establishment') || types.includes('point_of_interest')
}

function fromGoogle(
  s: google.maps.places.AutocompleteSuggestion,
  session: PlaceSession,
): PlaceSuggestion | null {
  const p = s.placePrediction
  if (!p) return null
  const title = p.mainText?.text ?? p.text.text
  const subtitle = p.secondaryText?.text ?? ''
  const predicted = p.text.text
  const types = p.types ?? []
  return {
    id: p.placeId,
    title,
    subtitle,
    label: predicted,
    resolve: async () => {
      const place = p.toPlace()
      // The session token rides along automatically on the first fetchFields of
      // a Place made from this session's prediction; that call is what ends it.
      await place.fetchFields({ fields: ['location', 'viewport', 'formattedAddress'] })
      session.token = undefined
      const loc = place.location
      if (!loc) throw new Error('Google returned a place without a location')
      const formatted = place.formattedAddress?.trim()
      const label = formatted
        ? isEstablishment(types) && !formatted.toLowerCase().startsWith(title.toLowerCase())
          ? `${title}, ${formatted}`
          : formatted
        : predicted
      const viewport = place.viewport?.toJSON()
      return {
        id: p.placeId,
        title,
        label,
        position: { lat: loc.lat(), lng: loc.lng() },
        viewport: viewport ?? undefined,
      }
    },
  }
}

function fromHere(item: HerePlace): PlaceSuggestion {
  const comma = item.label.indexOf(',')
  const title = item.title || (comma > 0 ? item.label.slice(0, comma) : item.label)
  const subtitle =
    item.label && item.label !== title
      ? item.label.startsWith(`${title}, `)
        ? item.label.slice(title.length + 2)
        : item.label
      : ''
  return { id: item.id, title, subtitle, label: item.label || item.title, resolve: async () => item }
}

/**
 * Suggestions for what the user has typed so far. Google when it can be, HERE
 * otherwise; the caller cannot tell which and does not need to. Never throws
 * for an empty or too-short query — it returns [] so the field simply shows
 * nothing.
 */
export async function suggestPlaces(
  query: string,
  session: PlaceSession,
  view?: MapViewport | null,
): Promise<PlaceSuggestion[]> {
  const input = query.trim()
  if (!input) return []

  const lib = await placesLib()
  if (lib) {
    try {
      session.token ??= new lib.AutocompleteSessionToken()
      const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: session.token,
        locationBias: biasFor(view),
      })
      return suggestions
        .map((s) => fromGoogle(s, session))
        .filter((s): s is PlaceSuggestion => s !== null)
    } catch (err) {
      reportPlacesFailure(err)
    }
  }

  // HERE Discover: the server short-circuits anything under three characters.
  if (input.length < 3) return []
  const res = await api.here.search(input)
  return res.items.map(fromHere)
}
