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
import { rem } from '../lib/density'

type Props = {
  /** Design-px diameter (rendered as rem) — match the DM Avatar so every
   *  conversation reads the same. */
  size?: number
  /** The vehicle group's id. Needed (with `hasAvatar`) to render an uploaded
   *  image; without it the generated multi-user glyph is shown. */
  groupId?: string
  /** Whether this group has an uploaded image. */
  hasAvatar?: boolean
  /** Bump to bust the cache after a manager changes/removes the image. */
  version?: number | string
  /** Slot geometry. 'circle' (default) matches the DM avatar; 'rounded' is a
   *  squircle used in the sidebar list so a vehicle room reads as a room — not a
   *  person — by SHAPE alone, at a glance, with no extra colour. */
  shape?: 'circle' | 'rounded'
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
  shape = 'circle',
  className = '',
}: Props) {
  const showImage = Boolean(groupId && hasAvatar)
  // Circular by default (matches the DM avatar); a `card`-radius squircle in the
  // sidebar list so rooms are distinguishable from people by shape, not colour.
  const radius = shape === 'rounded' ? 'rounded-card' : 'rounded-full'
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

  const style = { width: rem(size), height: rem(size) }
  // No-image fallback: a MULTI-PERSON glyph on the same lifted neutral disc as
  // the user Avatar, so both fallbacks share one treatment and differ only in
  // what they depict — one person vs several. The room-vs-person distinction is
  // also carried by SHAPE (circle vs squircle), so the two cues reinforce each
  // other. Hairline border, matching the user Avatar; it disappears behind a
  // real image once one loads.
  // Deliberately lucide's drawing rather than a hand-rolled silhouette to match
  // Avatar's filled glyph: a bespoke two-person shape has to solve head
  // separation, shoulder overlap and overall proportion at ~25px, and the
  // attempts at it read squat and cracked. A properly drawn icon wins over a
  // matching-but-bad one.
  const fallback = (
    <span
      style={style}
      className={`${radius} bg-surface-2 border border-line flex items-center justify-center shrink-0 text-muted ${className}`}
    >
      <Users size={rem(Math.max(12, Math.round(size * 0.52)))} strokeWidth={1.7} />
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
        draggable={false}
        onLoad={() => {
          markAvatarLoaded('group', groupId!, version)
          setLoaded(true)
        }}
        onError={() => {
          markAvatarFailed('group', groupId!, version)
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
