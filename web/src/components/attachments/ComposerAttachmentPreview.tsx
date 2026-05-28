import { X } from 'lucide-react'
import { DocIcon, formatBytes } from './attachmentUtils'

type Props = {
  file: File
  previewUrl: string | null
  onRemove: () => void
}

// In-composer preview row. Sits above the textarea inside the composer card
// and reserves a remove-button so the user can drop the staged file before
// sending.
export default function ComposerAttachmentPreview({ file, previewUrl, onRemove }: Props) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.06]">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={file.name}
          className="h-10 w-10 rounded-chip object-cover shrink-0 border border-white/[0.10]"
        />
      ) : (
        <div className="h-10 w-10 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
          <DocIcon mime={file.type} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text truncate">{file.name}</div>
        <div className="text-[10.5px] text-muted">{formatBytes(file.size)}</div>
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove attachment"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
      >
        <X size={13} strokeWidth={1.8} />
      </button>
    </div>
  )
}
