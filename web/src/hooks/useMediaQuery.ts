import { useEffect, useState } from 'react'

// Live `window.matchMedia` result. Reads synchronously on first render so a
// layout that depends on it (e.g. whether a side panel is in-flow or an
// overlay) never paints the wrong branch first.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? false),
  )
  useEffect(() => {
    const mql = window.matchMedia?.(query)
    if (!mql) return
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
