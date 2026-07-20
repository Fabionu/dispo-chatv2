import { useRef, useState } from 'react'
import type { DragEvent } from 'react'

// Drag-and-drop file staging extracted from ChatView. Tracks whether a file
// drag is over the drop zone (a depth counter keeps it stable across child
// enter/leave events) and hands the first dropped file to `onFile`. `blocked`
// suppresses the whole affordance while an overlay/edit makes dropping invalid
// — matching the original inline behavior exactly, including still resetting
// the depth counter on a blocked drop so the overlay never sticks.
export function useFileDrop({
  blocked,
  onFile,
}: {
  blocked: boolean
  onFile: (file: File) => void
}) {
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)

  // True only when the drag actually carries files (ignore text/element drags).
  const dragHasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

  function onDragEnter(e: DragEvent) {
    if (blocked || !dragHasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }
  function onDragOver(e: DragEvent) {
    if (blocked || !dragHasFiles(e)) return
    // preventDefault is required for the drop event to fire.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: DragEvent) {
    if (!dragHasFiles(e)) return
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragActive(false)
    }
  }
  function onDrop(e: DragEvent) {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    if (blocked) return
    // One attachment per message — take the first dropped file.
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return {
    dragActive,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
