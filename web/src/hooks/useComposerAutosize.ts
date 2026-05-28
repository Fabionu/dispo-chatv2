import { useLayoutEffect, type RefObject } from 'react'

// Resize a textarea so its height tracks its content. Resets to `auto`
// first so the element can shrink, then pins to scrollHeight. CSS
// max-height clamps growth at the configured cap; once we hit that, the
// textarea's own overflow takes over.
export function useComposerAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}
