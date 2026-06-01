// Dev-only debug logging. Compiles to a no-op in production builds (the
// import.meta.env.DEV branch is dead-code-eliminated), so these traces never
// ship to users. Used to diagnose chat scroll/optimistic timing.
export const devlog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args: unknown[]) => console.debug(`[chat +${Math.round(performance.now())}ms]`, ...args)
  : () => {}
