/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark surface hierarchy (darkest → lightest) ──────────────────────
        // bg    — the chat / message area and the workspace void behind the
        //         cards: a calm NEUTRAL dark grey (the darkest primary surface).
        //         Also the dark foreground placed on accent chips/buttons
        //         (`text-bg`).
        // rail / surface — the SIDEBAR, the Group Info panel, modals, settings
        //         panels and elevated chrome (menus, popovers, footers): one step
        //         lighter than `bg`, so all of these read as ONE consistent
        //         surface family that lifts gently off the chat. Selected/hover/
        //         search use white-alpha overlays (base-independent), which read
        //         as subtly lighter on top of this surface. Kept equal so sidebar
        //         + chrome share one tone.
        // composer — the chat input field: one step lighter again than `surface`
        //         so the floating input reads as raised off the panels.
        // surface-2 — the extra lift for focus / hover states.
        // All surfaces are pure neutral greys (R=G=B) — no warm/brown undertone.
        bg: '#181818',
        surface: '#262626',
        'surface-2': '#303030',
        rail: '#262626',
        composer: '#2f2f2f',
        text: '#f5f5f5',
        // Secondary / tertiary text. Neutral cool-grey (no beige/brown tint),
        // lifted for legibility on the dark panels:
        //   muted — secondary labels, meta, section text: clearly readable but
        //           still below `text`.
        //   faint — timestamps, hints, placeholders: subtle but NOT invisible.
        muted: '#a3a3a3',
        faint: '#767676',
        done: '#7d8a78',
        active: '#c89572',
        alert: '#d97757',
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.08)',
        strong: 'rgba(255,255,255,0.16)',
        light: 'rgba(255,255,255,0.05)',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        chip: '4px',
        btn: '5px',
        card: '6px',
        modal: '7px',
      },
      letterSpacing: {
        eyebrow: '0.14em',
        badge: '0.07em',
      },
    },
  },
  plugins: [],
}
