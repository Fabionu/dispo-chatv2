import { useEffect, useState } from 'react'
import { Box } from 'lucide-react'
import { rem } from '../lib/density'

type Props = {
  /** Design-px size of the square (rendered as rem). */
  size?: number
  /** Bump to bust the cache after an admin changes the logo. */
  version?: number | string
  className?: string
}

// Company logo in a rounded chip. Falls back to the default Box icon when the
// workspace has no logo (the image request 404s).
export default function CompanyLogo({ size = 28, version, className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [version])

  const style = { width: rem(size), height: rem(size) }

  if (failed) {
    return (
      <div
        style={style}
        className={`rounded-chip border border-white/[0.1] bg-white/[0.03] flex items-center justify-center shrink-0 ${className}`}
      >
        <Box size={rem(Math.round(size * 0.5))} strokeWidth={1.6} />
      </div>
    )
  }

  const src = `/api/company-profile/logo${version != null ? `?v=${version}` : ''}`
  return (
    <img
      src={src}
      alt="Company logo"
      onError={() => setFailed(true)}
      style={style}
      className={`rounded-chip object-cover border border-white/[0.1] bg-surface shrink-0 ${className}`}
    />
  )
}
