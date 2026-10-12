import { useEffect, useLayoutEffect, type RefObject } from 'react'

// Resize a textarea so its height tracks its content. Resets to `auto`
// first so the element can shrink, then pins to scrollHeight. CSS
// max-height clamps growth at the configured cap; once we hit that, the
// textarea's own overflow takes over. The resting height is the element's
// `rows` (the chat composer uses 1).
function fit(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function useComposerAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (el) fit(el)
  }, [ref, value])

  // The same text wraps onto a different number of lines when the field's
  // WIDTH changes — a side panel opening beside the thread, a window resize —
  // so re-fit then too. Width only: the observer also sees the height this hook
  // sets, and re-fitting on that would just measure the same value again.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit(el)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
}
