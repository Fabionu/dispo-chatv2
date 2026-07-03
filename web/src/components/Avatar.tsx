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

type Props = {
  userId: string
  name: string
  /** Design-px diameter (rendered as rem so it tracks the global UI scale). */
  size?: number
  /** Bump to bust the browser cache after the current user changes their image. */
  version?: number | string
  className?: string
}

// User avatar: the stored image when one exists, otherwise a generic white
// contact glyph on a neutral dark disc — never initials. The image URL 404s when
// the user has no avatar, which flips us to the fallback, so callers don't need
// to know in advance whether an avatar exists.
export default function Avatar({
  userId,
  name,
  size = 28,
  version,
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
  // No-photo fallback: a white generic-contact glyph on a neutral dark-grey disc
  // (`bg` — darker than the rail/panels), with only a hairline neutral border so
  // the circle stays defined even on the equally-dark chat header. No warm tint,
  // no initials — a photo-less person reads as a person, consistently everywhere.
  const fallbackNode = (
    <span
      style={style}
      className={`rounded-full bg-bg border border-white/[0.08] flex items-center justify-center shrink-0 text-text ${className}`}
    >
      <User size={rem(Math.max(13, Math.round(size * 0.58)))} strokeWidth={1.7} />
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
