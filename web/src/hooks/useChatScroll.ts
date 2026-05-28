import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LocalMessage } from '../components/messages/types'

// Encapsulates everything ChatView needs to keep the message list scrolled
// the way users expect:
//   - jump to bottom on initial load
//   - follow new messages when already at the bottom
//   - keep the viewport anchored when prepending older messages
//   - reveal a "scroll to latest" button when the user has drifted up
//   - re-pin after images load (their height grows after render)
export function useChatScroll(messages: LocalMessage[], loading: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const composerObserverRef = useRef<ResizeObserver | null>(null)
  // When prepending older messages we must keep the viewport anchored — we
  // record scrollHeight before the prepend and restore the delta after.
  const prependAnchorRef = useRef<number | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)

  // Scroll management. After the initial load jump to the newest message;
  // after a live message only follow if the user was already at the bottom;
  // after a prepend, restore the prior anchor so the view doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
      return
    }
    if (loading) return
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  // Watch the composer wrapper's height. When it grows/shrinks (a reply or
  // edit preview appears, an attachment preview is staged, or the textarea
  // auto-grows) the message list's available height changes — the flex layout
  // already lifts the list, this just keeps the user pinned to the latest
  // message across that reflow if they were already there.
  //
  // A callback ref (rather than an effect on a static ref) means the observer
  // re-attaches cleanly when the composer unmounts/remounts — e.g. when the
  // inline PDF preview takes over the pane and is then closed.
  const composerRef = useCallback((node: HTMLDivElement | null) => {
    composerObserverRef.current?.disconnect()
    composerObserverRef.current = null
    if (!node) return
    // Skip the first callback (fires on observe with the initial size) so we
    // don't fight the initial-load scroll.
    let primed = false
    const ro = new ResizeObserver(() => {
      if (!primed) {
        primed = true
        return
      }
      const scroller = scrollRef.current
      if (scroller && nearBottomRef.current) scroller.scrollTop = scroller.scrollHeight
    })
    ro.observe(node)
    composerObserverRef.current = ro
  }, [])

  useEffect(() => () => composerObserverRef.current?.disconnect(), [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    nearBottomRef.current = distanceFromBottom < 120
    // 240px keeps the button from flickering right at the edge: it lights up
    // only once the user has scrolled meaningfully away from the latest.
    setShowScrollDown(distanceFromBottom > 240)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    nearBottomRef.current = true
    setShowScrollDown(false)
  }, [])

  // Images change row height *after* their <img> finishes loading, so the
  // initial scroll-on-append isn't enough. If the user was at the bottom
  // when the message arrived, we re-pin them after every image load. If
  // they've intentionally scrolled up to read older messages, we leave
  // their view alone.
  const handleImageLoaded = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Call this before prepending older messages so the viewport stays
  // anchored to the same visible message after the new ones land.
  const anchorBeforePrepend = useCallback(() => {
    const el = scrollRef.current
    prependAnchorRef.current = el ? el.scrollHeight : null
  }, [])

  // Internal helper for send paths — pin the next render to bottom.
  const pinToBottomNext = useCallback(() => {
    nearBottomRef.current = true
  }, [])

  return {
    scrollRef,
    composerRef,
    onScroll,
    scrollToBottom,
    showScrollDown,
    handleImageLoaded,
    anchorBeforePrepend,
    pinToBottomNext,
  }
}
