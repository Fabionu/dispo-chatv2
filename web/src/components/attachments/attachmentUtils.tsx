import {
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
} from 'lucide-react'

// Allowed attachment types — split by category so the user can pick which
// kind of file the OS picker should narrow to. The server's allowlist is the
// union of both.
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const DOC_ACCEPT =
  'application/pdf,' +
  'application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'text/csv,text/plain'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_DOC_BYTES = 25 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Pick a sensible lucide icon for a document's mime type. Keeps the surface
// modest — three buckets is enough until we add previewing. `size`/`className`
// let callers scale it up (e.g. the large pre-send document card).
export function DocIcon({
  mime,
  size = 15,
  className = 'text-muted',
}: {
  mime: string
  size?: number
  className?: string
}) {
  if (mime === 'application/pdf' || mime === 'text/plain') {
    return <FileText size={size} strokeWidth={1.6} className={className} />
  }
  if (
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return <FileSpreadsheet size={size} strokeWidth={1.6} className={className} />
  }
  if (mime.startsWith('image/')) {
    return <ImageIcon size={size} strokeWidth={1.6} className={className} />
  }
  return <FileIcon size={size} strokeWidth={1.6} className={className} />
}
