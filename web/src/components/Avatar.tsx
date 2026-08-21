import { useEffect, useState } from 'react'
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
  className = '',
}: Props) {
  const [failed, setFailed] = useState(() => !userId || isAvatarFailed('user', userId, version))
  const [loaded, setLoaded] = useState(() => Boolean(userId) && isAvatarLoaded('user', userId, version))
  // Retry the image when the user or version changes (e.g. after an upload).
  useEffect(() => {
    setFailed(!userId || isAvatarFailed('user', userId, version))
    setLoaded(Boolean(userId) && isAvatarLoaded('user', userId, version))
    if (userId) void preloadAvatar('user', userId, version)?.then((ok) => {
      setFailed(!ok)
      setLoaded(ok)
    })
  }, [userId, version])

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
  const fallbackNode = (
    <span
      style={style}
      className={`rounded-full bg-surface-2 border border-line flex items-center justify-center shrink-0 ${
        fallback === 'initials' ? 'text-text/75' : 'text-muted'
      } ${className}`}
    >
      {fallback === 'initials' ? (
        <span
          aria-hidden
          style={{ fontSize: rem(Math.max(11, Math.round(size * 0.36))) }}
          className="font-semibold leading-none tracking-tight select-none"
        >
          {initials(name)}
        </span>
      ) : (
        <User size={rem(Math.max(13, Math.round(size * 0.52)))} strokeWidth={1.7} />
      )}
    </span>
  )

  if (failed || !userId) return fallbackNode

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
        className={`absolute inset-0 rounded-full object-cover bg-surface transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </span>
  )
}
