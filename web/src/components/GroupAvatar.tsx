import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'

type Props = {
  groupId: string
  /** Pixel diameter — match the DM Avatar so the header reads consistently. */
  size?: number
  /** Bump to bust the browser cache after the image is changed/removed. */
  version?: number | string
  className?: string
}

// Vehicle-group image: the stored picture when one exists, a themed multi-user
// icon otherwise. Mirrors the user `Avatar` (round, object-cover) so a group
// and a DM avatar share the exact same visual footprint in the chat header.
// The image URL 404s when the group has no avatar, flipping us to the icon —
// so callers don't need to know in advance whether one exists.
export default function GroupAvatar({ groupId, size = 28, version, className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  // Retry the image when the group or version changes (e.g. after an upload).
  useEffect(() => setFailed(false), [groupId, version])

  const style = { width: size, height: size }

  if (failed) {
    return (
      <span
        style={style}
        className={`rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-muted ${className}`}
      >
        <Users size={Math.max(12, Math.round(size * 0.46))} strokeWidth={1.7} />
      </span>
    )
  }

  const src = `/api/groups/${groupId}/avatar${version != null ? `?v=${version}` : ''}`
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={style}
      className={`rounded-full object-cover shrink-0 bg-surface ${className}`}
    />
  )
}
