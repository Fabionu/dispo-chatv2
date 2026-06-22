/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark surface hierarchy (darkest → lightest) ──────────────────────
        // bg    — the chat / message area and the workspace void behind the
        //         cards: the DARKEST surface, near-black, so the conversation
        //         reads as the deep focal plane everything else lifts off of.
        //         Also the dark foreground placed on accent chips/buttons
        //         (`text-bg`). ONLY this main conversation surface is this dark.
        // rail / surface — the SIDEBAR, the Group Info panel, modals, settings
        //         panels and elevated chrome (menus, popovers, footers): a
        //         lighter dark grey, so all of these read as ONE consistent
        //         surface family that floats clearly above the near-black chat.
        //         The composer/chat-input also uses `surface`, so the input
        //         field lifts off the near-black message area. Selected/hover/
        //         search use white-alpha overlays (base-independent), which read
        //         as subtly lighter on top of this surface. Kept equal so
        //         sidebar + chrome share one tone.
        // surface-2 — the extra lift for focus / hover states.
        bg: '#0b0b0c',
        surface: '#1d1d20',
        'surface-2': '#29292e',
        rail: '#1d1d20',
        text: '#f4f1ec',
        muted: '#8a8896',
        faint: '#4e4d5a',
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
