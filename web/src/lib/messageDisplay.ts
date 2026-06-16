// Message DISPLAY STYLE.
//
// Plain stream is now the ONLY message style — the no-bubble grouped
// "operational log" timeline. The bubble view and its settings toggle were
// retired. This tiny module survives as a hook + a startup applier so the
// reader in MessageRow and the <html data-msg-style> hook point don't change,
// but every resolution is 'plain' and any legacy stored 'bubble' preference is
// migrated to 'plain' on startup so it can never force the old view again.
//
// The bubble RENDERING code in MessageRow is left intact (simply never reached)
// in case the option is ever reinstated.

export type MessageDisplay = 'bubble' | 'plain'

const STORAGE_KEY = 'dispo:msg-style'

// The single supported style.
const STYLE: MessageDisplay = 'plain'

function apply(m: MessageDisplay) {
  document.documentElement.dataset.msgStyle = m
}

// React hook, kept for call-site stability (MessageRow). Always 'plain'.
export function useMessageDisplay(): MessageDisplay {
  return STYLE
}

// Call once at startup (before React renders): paint plain from the first frame
// and migrate any legacy stored choice (e.g. 'bubble') to 'plain'.
export function initMessageDisplay() {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(STORAGE_KEY) !== STYLE) localStorage.setItem(STORAGE_KEY, STYLE)
  } catch {
    /* ignore storage availability/quota — the attribute still applies */
  }
  apply(STYLE)
}
