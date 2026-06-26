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
  /** Pixel diameter — match the DM Avatar so every conversation reads the same. */
  size?: number
  /** The vehicle group's id. Needed (with `hasAvatar`) to render an uploaded
   *  image; without it the generated multi-user glyph is shown. */
  groupId?: string
  /** Whether this group has an uploaded image. */
  hasAvatar?: boolean
  /** Bump to bust the cache after a manager changes/removes the image. */
  version?: number | string
  className?: string
}

// Vehicle-room identity slot. Shows the group's UPLOADED image when one exists,
// otherwise a GENERATED, generic multi-user glyph — in the same circular slot as
// a DM `Avatar`, so every conversation reads the same. The image URL 404s when
// the group has no avatar, which flips us back to the glyph, so callers don't
// need to know in advance whether an image exists. Call sites that pass no
// `groupId`/`hasAvatar` simply get the glyph (e.g. compact rows, optimistic).
export default function GroupAvatar({
  size = 28,
  groupId,
  hasAvatar,
  version,
  className = '',
}: Props) {
  const showImage = Boolean(groupId && hasAvatar)
  const [failed, setFailed] = useState(() => !showImage || isAvatarFailed('group', groupId!, version))
  const [loaded, setLoaded] = useState(() => showImage && isAvatarLoaded('group', groupId!, version))

  // Retry the image when the group or version changes (e.g. after an upload).
  useEffect(() => {
    if (!showImage) {
      setFailed(true)
      setLoaded(false)
      return
    }
    setFailed(isAvatarFailed('group', groupId!, version))
    setLoaded(isAvatarLoaded('group', groupId!, version))
    void preloadAvatar('group', groupId!, version)?.then((ok) => {
      setFailed(!ok)
      setLoaded(ok)
    })
  }, [showImage, groupId, version])

  const style = { width: size, height: size }
  // No-image fallback: a white multi-user glyph on the SAME neutral dark-grey
  // disc as the user Avatar (so every fallback matches the theme), but a distinct
  // icon so a group reads as a group. No warm tint; hairline neutral border keeps
  // the circle defined on the equally-dark chat header.
  const fallback = (
    <span
      style={style}
      className={`rounded-full bg-bg border border-white/[0.08] flex items-center justify-center shrink-0 text-text ${className}`}
    >
      <Users size={Math.max(12, Math.round(size * 0.46))} strokeWidth={1.7} />
    </span>
  )

  if (failed || !showImage) return fallback

  const src = avatarUrl('group', groupId!, version)
  return (
    <span style={style} className={`relative inline-flex shrink-0 ${className}`}>
      {fallback}
      <img
        src={src}
        alt=""
        onLoad={() => {
          markAvatarLoaded('group', groupId!, version)
          setLoaded(true)
        }}
        onError={() => {
          markAvatarFailed('group', groupId!, version)
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
