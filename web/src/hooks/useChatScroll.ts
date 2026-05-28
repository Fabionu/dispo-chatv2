import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LocalMessage } from '../components/messages/types'

// Keeps the message list scrolled the way users expect — WITHOUT scrolling
// "whenever the messages array changes". Movement is event-driven: each change
// is classified by what happened at the ENDS of the list, and we only move the
// viewport for the cases that warrant it:
//
//   initial-load / cached-open : land at the bottom once, instantly
//   append-new (incl. own send): follow to the bottom only if already near it
//   prepend-older              : restore the pre-prepend anchor (no visible move)
//   revalidate / in-place edit : preserve scrollTop exactly (no move at all)
//
// This is what stops the "open a cached conversation → it jumps a few seconds
// later" bug: background revalidation produces a new (often content-identical)
// messages array, which previously re-pinned to the bottom. Now an unchanged
// tail is a no-op. Native CSS scroll-anchoring keeps content steady when an
// off-screen message above the viewport changes height, so the preserve path
// is a deliberate no-op there too.
export function useChatScroll(messages: LocalMessage[], loading: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const composerObserverRef = useRef<ResizeObserver | null>(null)
  // When prepending older messages we must keep the viewport anchored — we
  // record scrollHeight before the prepend and restore the delta after.
  const prependAnchorRef = useRef<number | null>(null)
  // Change-classification state. These reset per conversation because ChatView
  // remounts this hook on group switch (so no stale anchors carry over).
  const didInitialRef = useRef(false)
  const prevFirstIdRef = useRef<string | null>(null)
  const prevLastIdRef = useRef<string | null>(null)
  const prevLenRef = useRef(0)
  const [showScrollDown, setShowScrollDown] = useState(false)

  // Classify the change at the list ends and move the viewport only when the
  // event type calls for it. Runs after DOM mutation, before paint, so any
  // positioning we do is invisible (no pre-scroll frame).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const len = messages.length
    const firstId = len ? messages[0].id : null
    const lastId = len ? messages[len - 1].id : null
    const remember = () => {
      prevFirstIdRef.current = firstId
      prevLastIdRef.current = lastId
      prevLenRef.current = len
    }

    // prepend-older: an older page was just loaded above the viewport. Restore
    // the recorded anchor so the visible message stays put.
    if (prependAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
      remember()
      return
    }

    // Nothing to anchor against yet (still loading, or an empty thread).
    if (loading || len === 0) {
      remember()
      return
    }

    // initial-load / cached-open: land at the bottom exactly once per
    // conversation, instantly.
    if (!didInitialRef.current) {
      didInitialRef.current = true
      el.scrollTop = el.scrollHeight
      nearBottomRef.current = true
      remember()
      return
    }

    // append-new: the tail id changed AND the list grew, with the head
    // unchanged — i.e. new message(s) at the bottom (live arrival or our own
    // optimistic send, which pins nearBottom first so it always follows).
    const appendedAtEnd =
      len > prevLenRef.current &&
      lastId !== prevLastIdRef.current &&
      firstId === prevFirstIdRef.current
    if (appendedAtEnd) {
      if (nearBottomRef.current) el.scrollTop = el.scrollHeight
      remember()
      return
    }

    // revalidate / in-place edit / unchanged tail (e.g. optimistic→real swap):
    // preserve scrollTop exactly — do not move.
    remember()
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
