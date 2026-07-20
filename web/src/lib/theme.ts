import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'dispo:theme'

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isTheme(value) ? value : 'dark'
  } catch {
    return 'dark'
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore storage failures — the live theme still applies */
  }
  apply(theme)
}

export function initTheme() {
  if (typeof document === 'undefined') return
  apply(getStoredTheme())
}

// Subscribe to the root attribute so every settings surface reflects changes
// immediately, including changes made by another mounted component.
export function useTheme(): Theme {
  const [theme, setLiveTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'dark'
    const value = document.documentElement.dataset.theme
    return isTheme(value) ? value : getStoredTheme()
  })

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const value = root.dataset.theme
      if (isTheme(value)) setLiveTheme(value)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
