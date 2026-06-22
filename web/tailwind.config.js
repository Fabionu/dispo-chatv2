/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark surface hierarchy (darkest → lightest) ──────────────────────
        // bg    — the chat / message area and the workspace void behind the
        //         cards: a calm dark GREY (the darkest primary surface). Also the
        //         dark foreground placed on accent chips/buttons (`text-bg`).
        // rail / surface — the SIDEBAR, the Group Info panel, modals, settings
        //         panels and elevated chrome (menus, popovers, footers): one step
        //         lighter than `bg`, so all of these read as ONE consistent
        //         surface family that lifts gently off the chat. The composer/
        //         chat-input also uses `surface`. Selected/hover/search use
        //         white-alpha overlays (base-independent), which read as subtly
        //         lighter on top of this surface. Kept equal so sidebar + chrome
        //         share one tone.
        // surface-2 — the extra lift for focus / hover states.
        bg: '#18181b',
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
