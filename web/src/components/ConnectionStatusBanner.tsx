import { useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, WifiOff } from 'lucide-react'
import {
  useConnectionStatus,
  type ConnectionStatus,
} from '../hooks/useConnectionStatus'

type DisplayStatus = Exclude<ConnectionStatus, 'connected'> | 'restored' | null

// Global, transient connection feedback. Brief reconnects are intentionally
// hidden to avoid visual flicker; an actual outage remains visible until the
// socket recovers, then confirms that missed state is being synchronized.
export default function ConnectionStatusBanner() {
  const status = useConnectionStatus()
  const previous = useRef(status)
  const problemShown = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [display, setDisplay] = useState<DisplayStatus>(null)

  useEffect(() => {
    window.clearTimeout(timer.current)
    const wasDisconnected = previous.current !== 'connected'
    previous.current = status

    if (status === 'connected') {
      if (wasDisconnected && problemShown.current) {
        setDisplay('restored')
        timer.current = window.setTimeout(() => setDisplay(null), 1800)
      } else {
        setDisplay(null)
      }
      problemShown.current = false
    } else if (status === 'offline') {
      problemShown.current = true
      setDisplay('offline')
    } else {
      // Do not flash a warning for sub-second transport handovers.
      timer.current = window.setTimeout(() => {
        problemShown.current = true
        setDisplay('reconnecting')
      }, 700)
    }

    return () => window.clearTimeout(timer.current)
  }, [status])

  if (!display) return null

  const restored = display === 'restored'
  const offline = display === 'offline'
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[100] -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/[0.10] bg-surface-2 px-3 py-1.5 text-[0.75rem] font-medium text-text shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
    >
      {restored ? (
        <Check size="0.875rem" className="text-done" strokeWidth={2} />
      ) : offline ? (
        <WifiOff size="0.875rem" className="text-muted" strokeWidth={1.8} />
      ) : (
        <RefreshCw size="0.875rem" className="animate-spin text-muted" strokeWidth={1.8} />
      )}
      {restored ? 'Back online — syncing updates…' : offline ? 'You are offline' : 'Reconnecting…'}
    </div>
  )
}
