import { useEffect, useState } from 'react'

// Reports "away" when the user has been inactive for `timeoutMs`, or whenever
// the tab is hidden. Any pointer/keyboard/focus activity clears it immediately.
// Drives auto-away presence. Pure client-side — it doesn't change the user's
// stored (manual) status, only their live presence.
export function useIdle(timeoutMs = 5 * 60 * 1000): boolean {
  const [away, setAway] = useState(false)

  useEffect(() => {
    let timer: number | undefined

    function reset() {
      window.clearTimeout(timer)
      if (document.hidden) {
        setAway(true)
        return
      }
      setAway(false)
      timer = window.setTimeout(() => setAway(true), timeoutMs)
    }

    function onVisibility() {
      if (document.hidden) setAway(true)
      else reset()
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'focus']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    reset()

    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [timeoutMs])

  return away
}
