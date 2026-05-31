import { useEffect, useState } from 'react'
import { initials } from './messages/messageUtils'

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
  const [failed, setFailed] = useState(false)
  // Retry the image when the user or version changes (e.g. after an upload).
  useEffect(() => setFailed(false), [userId, version])

  const style = { width: size, height: size }

  if (failed) {
    return (
      <span
        style={style}
        className={`rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 font-semibold uppercase font-mono leading-none ${className}`}
      >
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}>{initials(name)}</span>
      </span>
    )
  }

  const src = `/api/users/${userId}/avatar${version != null ? `?v=${version}` : ''}`
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      style={style}
      className={`rounded-full object-cover shrink-0 bg-surface ${className}`}
    />
  )
}
