import { useEffect, useId, useState } from 'react'
import { User } from 'lucide-react'
import {
  avatarUrl,
  isAvatarFailed,
  isAvatarLoaded,
  markAvatarFailed,
  markAvatarLoaded,
  preloadAvatar,
} from '../lib/avatarCache'
import { rem } from '../lib/density'
import { initials } from './messages/messageUtils'

type Props = {
  userId: string
  name: string
  /** Design-px diameter (rendered as rem so it tracks the global UI scale). */
  size?: number
  /** Bump to bust the browser cache after the current user changes their image. */
  version?: number | string
  /**
   * What to draw when there's no photo. 'glyph' (default) is the generic contact
   * silhouette — a photo-less person still reads as a person. 'initials' names
   * WHICH person instead, and is opt-in for LISTS of people, where a column of
   * identical silhouettes tells the eye nothing.
   */
  fallback?: 'glyph' | 'initials'
  /**
   * 'circle' (default) everywhere the app draws a person as a disc. 'square' is
   * for the message timeline, where every radius token is 0 and a disc would be
   * the only rounded object on the screen.
   */
  shape?: 'circle' | 'square'
  /**
   * Colour for the no-photo monogram — its hairline and its letters, with no
   * disc behind them. The thread passes the author's own rule hue, so someone
   * without a photo still reads as the same identity their message rule
   * carries. Ignored once a real photo loads, and ignored by the glyph
   * fallback, which is deliberately anonymous.
   */
  tint?: string
  /**
   * Whether this user has an image on file, when the caller already knows from
   * a roster it has loaded. `false` skips the request and draws the fallback
   * straight away; `undefined` — every call site that does not know — keeps the
   * original behaviour of asking and letting a 404 flip us to the fallback.
   *
   * Note this is the OPPOSITE default to GroupAvatar's prop of the same name,
   * where undefined means "no image". A group's avatar is the exception and a
   * person's is the norm, so each defaults to the answer that is usually right.
   */
  hasAvatar?: boolean
  className?: string
}

// User avatar: the stored image when one exists, otherwise a fallback on a
// neutral dark disc — the generic contact glyph, or the person's initials where
// the caller opts in (see `fallback`). The image URL 404s when the user has no
// avatar, which flips us to the fallback, so callers don't need to know in
// advance whether an avatar exists.
export default function Avatar({
  userId,
  name,
  size = 28,
  version,
  fallback = 'glyph',
  shape = 'circle',
  tint,
  hasAvatar,
  className = '',
}: Props) {
  // `hasAvatar === false` is a caller telling us not to bother asking, so it
  // folds into the same flag as "no id" and "the request already 404'd".
  // Unique per instance, for the tinted monogram's SVG mask below. Declared up
  // here with the other hooks because it must run on every render, including the
  // ones that never reach the tinted branch.
  // React's useId emits colons (":r1:"). They are legal in an id attribute and
  // resolve fine as a url(#…) fragment, but they are NOT legal in a CSS selector
  // — so anything that later reaches for this node with querySelector would need
  // escaping. Strip them and prefix, so the id is a plain name either way.
  const maskId = `avatar-mask-${useId().replace(/:/g, '')}`
  const showImage = Boolean(userId) && hasAvatar !== false
  const [failed, setFailed] = useState(() => !showImage || isAvatarFailed('user', userId, version))
  const [loaded, setLoaded] = useState(() => showImage && isAvatarLoaded('user', userId, version))
  // Retry the image when the user or version changes (e.g. after an upload).
  useEffect(() => {
    setFailed(!showImage || isAvatarFailed('user', userId, version))
    setLoaded(showImage && isAvatarLoaded('user', userId, version))
    if (showImage) void preloadAvatar('user', userId, version)?.then((ok) => {
      setFailed(!ok)
      setLoaded(ok)
    })
  }, [showImage, userId, version])

  const style = { width: rem(size), height: rem(size) }
  // No-photo fallback: a contact glyph in `muted` on a LIFTED neutral disc
  // (`surface-2`). The lift is what carries the placeholder — on `bg` the disc
  // was the exact tone of the rail behind it, so the glyph floated on nothing and
  // needed a loud ring to be seen at all. With a filled disc the border drops
  // back to a hairline that only defines the edge. The disc is drawn by the
  // fallback only: a real photo covers this box exactly, so photographed avatars
  // stay unringed. No warm tint, no initials — a photo-less person reads as a
  // person, consistently everywhere.
  // Same lucide drawing, weight and box fraction as GroupAvatar's `Users`, so a
  // person and a room are one family differing only in headcount. Lucide draws
  // every icon on a shared 24 grid with matched optical sizing, so both render at
  // the SAME fraction — per-icon scale fudging is what makes icon sets drift.
  //
  // `fallback="initials"` swaps the glyph for the person's initials in the SAME
  // disc — same fill, same hairline, same diameter — so an opted-in list keeps
  // the identity column's geometry and only changes what fills it. The letters
  // sit one step brighter than the glyph because they carry information rather
  // than merely marking a slot, and they're aria-hidden: every call site already
  // renders the name as text beside them.
  //
  // A TINTED monogram is a SOLID tile of the caller's colour with the letters
  // KNOCKED OUT of it (user, 2026-08-26). It was briefly the inverse — a
  // hairline with the letters drawn in the tint — on the "fields are drawn, not
  // filled" rule the rest of the UI follows. Two reasons the inverse loses here:
  // a photo-less tile sits directly beside photographed ones and has to hold the
  // same visual weight as a full-bleed image, which an outline does not; and the
  // colour IS the identity (it is the author's rule hue), so the more of it the
  // tile shows, the better it does its job.
  //
  // The letters are a real HOLE, not letters painted in the background colour.
  // An SVG mask punches them out of the fill, so whatever is behind the tile
  // shows through — which matters wherever the tile is not sitting on the bare
  // field: a rail row's hover wash, a selected row, a highlighted message. Paint
  // them `--color-bg` instead and they stay flat black while everything around
  // them lifts.
  //
  // The mask id has to be unique per instance — several of these render at once
  // — hence useId. Font properties are inherited by SVG text from the span, so
  // the glyphs are the same Inter as the drawn version was.
  const radius = shape === 'square' ? '' : 'rounded-full'
  const tinted = Boolean(tint) && fallback === 'initials'
  const letterPx = Math.max(11, Math.round(size * 0.36))
  // The KNOCKOUT letters are set larger than the painted ones, and that is not
  // an inconsistency — it is the correction for what knockout does to type.
  // Painted letters are read as ink on a field: you see the strokes. Cut out of
  // a solid tile they are read as the gaps between colour, so the counters do
  // the work and the same point size lands visibly smaller and thinner.
  //
  // 0.44 of the tile, up from the painted variant's 0.36. The ceiling is set by
  // the WIDEST pair, not the average one: initials are proportional type, so one
  // size produces a real spread — measured across TT / IL / MW / AS, the pair
  // occupies 33-82% of the tile's width at this setting. 0.46 read better for an
  // average pair but pushed "MW" to 88%, leaving under 2px of margin at the
  // rendered size, which looks like a monogram jammed into its box. At 0.44 the
  // worst case still keeps ~9% of the tile clear each side.
  const knockoutPx = Math.max(12, Math.round(size * 0.44))
  const fallbackNode = tinted ? (
    <span
      style={{ ...style, color: tint }}
      // inline-flex, not the default inline: a span that stays inline ignores
      // width and height outright, and the tile sized itself to the SVG's
      // intrinsic box instead — 137px where 26 was asked for.
      className={`${radius} inline-flex shrink-0 overflow-hidden ${className}`}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        aria-hidden
        className="block select-none"
      >
        <mask id={maskId}>
          {/* White keeps the fill, black removes it — so the rect is the tile
              and the text is the hole. */}
          <rect width={size} height={size} fill="#fff" />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={knockoutPx}
            fontWeight={600}
            letterSpacing="-0.02em"
            fill="#000"
          >
            {initials(name)}
          </text>
        </mask>
        <rect width={size} height={size} fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    </span>
  ) : (
    <span
      style={style}
      className={`${radius} border bg-surface-2 border-line flex items-center justify-center shrink-0 ${
        fallback === 'initials' ? 'text-text/75' : 'text-muted'
      } ${className}`}
    >
      {fallback === 'initials' ? (
        <span
          aria-hidden
          style={{ fontSize: rem(letterPx) }}
          className="font-semibold leading-none tracking-tight select-none"
        >
          {initials(name)}
        </span>
      ) : (
        <User size={rem(Math.max(13, Math.round(size * 0.52)))} strokeWidth={1.7} />
      )}
    </span>
  )

  if (failed || !showImage) return fallbackNode

  const src = avatarUrl('user', userId, version)
  return (
    <span style={style} className={`relative inline-flex shrink-0 ${className}`}>
      {fallbackNode}
      <img
        src={src}
        alt={name}
        draggable={false}
        onLoad={() => {
          markAvatarLoaded('user', userId, version)
          setLoaded(true)
        }}
        onError={() => {
          markAvatarFailed('user', userId, version)
          setFailed(true)
        }}
        style={style}
        className={`absolute inset-0 ${radius} object-cover bg-surface transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </span>
  )
}
