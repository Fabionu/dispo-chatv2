import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import {
  avatarUrl,
  isAvatarFailed,
  isAvatarLoaded,
  markAvatarFailed,
  markAvatarLoaded,
  preloadAvatar,
} from '../lib/avatarCache'

type Props = {
  groupId: string
  /** Pixel diameter — match the DM Avatar so the header reads consistently. */
  size?: number
  /** Bump to bust the browser cache after the image is changed/removed. */
  version?: number | string
  className?: string
}

// Vehicle-group image: the stored picture when one exists, a themed multi-user
// icon otherwise. Mirrors the user `Avatar` exactly — instant fallback, a
// session cache (see lib/avatarCache) so a revisited group shows its image with
// no flash, no repeated 404s for groups without an image, and a smooth fade-in
// when the real picture decodes. The image URL 404s when the group has no
// avatar, which flips us to the icon — so callers needn't know in advance.
export default function GroupAvatar({ groupId, size = 28, version, className = '' }: Props) {
  const [failed, setFailed] = useState(() => !groupId || isAvatarFailed('group', groupId, version))
  const [loaded, setLoaded] = useState(() => Boolean(groupId) && isAvatarLoaded('group', groupId, version))

  // Re-evaluate from the cache (and warm it) whenever the group or version
  // changes — e.g. after an upload/remove bumps the version.
  useEffect(() => {
    setFailed(!groupId || isAvatarFailed('group', groupId, version))
    setLoaded(Boolean(groupId) && isAvatarLoaded('group', groupId, version))
    if (groupId)
      void preloadAvatar('group', groupId, version)?.then((ok) => {
        setFailed(!ok)
        setLoaded(ok)
      })
  }, [groupId, version])

  const style = { width: size, height: size }
  const fallback = (
    <span
      style={style}
      className={`rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-muted ${className}`}
    >
      <Users size={Math.max(12, Math.round(size * 0.46))} strokeWidth={1.7} />
    </span>
  )

  if (failed || !groupId) return fallback

  const src = avatarUrl('group', groupId, version)
  return (
    <span style={style} className={`relative inline-flex shrink-0 ${className}`}>
      {fallback}
      <img
        src={src}
        alt=""
        onLoad={() => {
          markAvatarLoaded('group', groupId, version)
          setLoaded(true)
        }}
        onError={() => {
          markAvatarFailed('group', groupId, version)
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
