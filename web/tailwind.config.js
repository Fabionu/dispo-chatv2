/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark surface hierarchy (darkest → lightest) ──────────────────────
        // bg    — the chat / message area and the workspace void behind the
        //         cards: pure black (the darkest primary surface).
        //         Also the dark foreground placed on accent chips/buttons
        //         (`text-bg`).
        // rail / surface — Group Info, modals, settings panels and elevated
        //         chrome (menus, popovers, footers): the same #202020 tone as the
        //         chat card, so every large panel and action layer belongs to one
        //         consistent surface family. Selected/hover/
        //         search use white-alpha overlays (base-independent), which read
        //         as subtly lighter on top of this surface. Kept equal so sidebar
        //         + chrome share one tone.
        // composer — a near-black secondary tone for the chat input field. It
        //         softens the transition from the pure-black shell to the raised
        //         chat card without looking like another grey panel.
        // surface-2 — the extra lift for focus / hover states.
        // All surfaces are pure neutral greys (R=G=B) — no warm/brown undertone.
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        // Main conversation card: the midpoint between the near-black outgoing
        // surfaces (#101010) and incoming bubbles (#303030).
        chat: 'rgb(var(--color-chat) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--color-surface-2) / <alpha-value>)',
        rail: 'rgb(var(--color-rail) / <alpha-value>)',
        composer: 'rgb(var(--color-composer) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        // Secondary / tertiary text. Neutral cool-grey (no beige/brown tint),
        // lifted for legibility on the dark panels:
        //   muted — secondary labels, meta, section text: clearly readable but
        //           still below `text`.
        //   faint — timestamps, hints, placeholders: subtle but NOT invisible.
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        faint: 'rgb(var(--color-faint) / <alpha-value>)',
        // Own-message bubble: near-black rather than pure black, softening its
        // weight on the raised chat card while right alignment carries ownership.
        'bubble-own': 'rgb(var(--color-bubble-own) / <alpha-value>)',
        done: 'rgb(var(--color-done) / <alpha-value>)',
        active: 'rgb(var(--color-active) / <alpha-value>)',
        alert: 'rgb(var(--color-alert) / <alpha-value>)',
        // `white` is the adaptive contrast wash used by translucent borders,
        // hovers and selected rows: white in dark mode, black in light mode.
        // Media/PDF surfaces that must remain literally white use pure-white.
        white: 'rgb(var(--color-wash) / <alpha-value>)',
        'pure-white': '#ffffff',
      },
      borderColor: {
        DEFAULT: 'rgb(var(--color-wash) / 0.08)',
        strong: 'rgb(var(--color-wash) / 0.16)',
        light: 'rgb(var(--color-wash) / 0.05)',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      // ── Radius scale (4 / 6 / 8 / 10 / 12) ───────────────────────────────
      // One geometric scale for every surface. Pick by ROLE, never a raw
      // rounded-* utility or an arbitrary value:
      //   chip  — tags, badges, tiny inline chips
      //   btn   — rectangular buttons, segmented-control items
      //   card  — cards, inputs/selects, menus, dropdowns, popovers
      //   modal — modal dialogs
      //   panel — the app's outer shells (sidebar / chat / info panel cards)
      //           and floating tool panels
      // Circular icon buttons use rounded-full (see ICON_ACTION_* in
      // HeaderIconButton.tsx).
      //   soft  — the pill-field family's companion radius: multi-line
      //           textareas, stop cards and other soft in-panel surfaces that
      //           sit alongside rounded-full pill inputs (EditableRow /
      //           tripFormStyles), plus the workspace tool cards. Anything
      //           that must visually pair with a pill uses this, never an
      //           arbitrary value.
      // Values are rem (design px / 16) so corners keep their proportion under
      // the --ui-scale root bump on 2K/4K displays; at the 16px baseline root
      // they render exactly the design px above.
      borderRadius: {
        chip: '0.25rem',
        btn: '0.375rem',
        card: '0.5rem',
        modal: '0.625rem',
        panel: '0.75rem',
        soft: '1.125rem',
      },
      letterSpacing: {
        eyebrow: '0.14em',
        badge: '0.07em',
      },
    },
  },
  plugins: [],
}
