import { useEffect, useState } from 'react'
import { initials } from './messages/messageUtils'
import {
  avatarUrl,
  isAvatarFailed,
  isAvatarLoaded,
  markAvatarFailed,
  markAvatarLoaded,
  preloadAvatar,
} from '../lib/avatarCache'

type Props = {
  userId: string
  name: string
  /** Pixel diameter. */
  size?: number
  /** Bump to bust the browser cache after the current user changes their image. */
  version?: number | string
  className?: string
}

// User avatar: the stored image when one exists, initials otherwise. The image
// URL 404s when the user has no avatar, which flips us to the initials fallback
// — so callers don't need to know in advance whether an avatar exists.
export default function Avatar({ userId, name, size = 28, version, className = '' }: Props) {
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

  const style = { width: size, height: size }
  const fallback = (
    <span
      style={style}
      className={`rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 font-semibold uppercase font-mono leading-none ${className}`}
    >
      <span style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}>{initials(name)}</span>
    </span>
  )

  if (failed || !userId) return fallback

  const src = avatarUrl('user', userId, version)
  return (
    <span style={style} className={`relative inline-flex shrink-0 ${className}`}>
      {fallback}
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
