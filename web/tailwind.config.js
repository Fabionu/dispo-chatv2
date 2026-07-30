/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark surface hierarchy (darkest → lightest) ──────────────────────
        // Values live in index.css (:root) — that file is the source of truth and
        // carries the full ladder comment; these are just the names.
        // bg    — the workspace void behind the two panels: pure black. Also the
        //         dark foreground placed on accent chips/buttons (`text-bg`).
        // panel / rail — Group Info, modals, settings panels and every other
        //         large surface opened in the workspace: the SAME tone as the
        //         chat window (see `panel` below).
        // surface — small floating chrome only (menus, dropdowns, popovers):
        //         #161616, one step up, because a popover must lift off
        //         whatever it covers. Selected/hover/search use white-alpha
        //         overlays (base-independent), which read as subtly lighter on
        //         any of these surfaces.
        // composer — the chat input capsule and my own message bubbles: one calm
        //         step above the chat window, so the capsule stays legible now
        //         that the conversation surface is near-black.
        // surface-2 — incoming bubbles + the extra lift for focus / hover states.
        // All surfaces are pure neutral greys (R=G=B) — no warm/brown undertone.
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        // The left rail — pure black, the app's deepest surface. It reads as one
        // field with the shell and is drawn by its hairline edge, not by a tone
        // step, which is what lets the chat window sit visibly above it.
        sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
        // The conversation window (main pane + message area): one step above the
        // black rail.
        chat: 'rgb(var(--color-chat) / <alpha-value>)',
        // Every large surface that opens IN the workspace — Group info, User
        // preview, My/User profile, Company profile, Account, settings drawers
        // and modal dialogs. Aliased to `chat` in index.css so all of them share
        // ONE base tone; they read apart from the conversation by edge +
        // elevation, and their content is separated by inner white/2 cards and
        // hairlines. `rail` is the legacy name for this same tone.
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
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
        // Own-message bubble: shares the composer's tone (my input and my
        // messages are one family), a calm step above the chat window while
        // right alignment and the tail shape carry ownership. It stays DARKER
        // than incoming (`surface-2`), so the two sides never trade places.
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
      // Bare `border` / `border-strong` / `border-light`. Kept on the SAME steps
      // as the wash scale below (8 / 16 / 6) so the two vocabularies can't drift
      // apart — `border` and `border-white/8` are the same line.
      borderColor: {
        DEFAULT: 'rgb(var(--color-wash) / 0.08)',
        strong: 'rgb(var(--color-wash) / 0.16)',
        light: 'rgb(var(--color-wash) / 0.06)',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      // ── Type scale (10 / 11 / 12 / 13 / 14 / 16 / 19 / 22 / 26) ───────────
      // The app previously carried NINETEEN hand-picked arbitrary sizes, six of
      // them between 10px and 13px (0.625 / 0.65625 / 0.6875 / 0.71875 / 0.75 /
      // 0.78125rem). Nobody can tell those apart, but every component was
      // maintaining its own — which is what made the UI read as approximately
      // right everywhere instead of deliberate. Pick a STEP, never an arbitrary
      // rem: an arbitrary value in a diff is now a visible smell.
      //   2xs — micro meta: badge counts, timestamps on dense rows
      //   xs  — secondary meta, hints, eyebrow labels
      //   sm  — dense UI text: menu items, chips, table cells
      //   base— default body/UI text
      //   lg  — emphasised row text, section titles
      //   xl  — panel/modal headings
      //   2xl/3xl/4xl — display: empty states, big numerals
      // Values are rem (design px / 16) so type tracks the --ui-scale root bump
      // on 2K/4K displays, same as the radius scale. Chat/sidebar text does NOT
      // use this scale — it stays on the px density tokens (--chat-msg-font-size,
      // --sidebar-*-font-size) so it can be tuned per display tier.
      fontSize: {
        '2xs': '0.625rem',
        xs: '0.6875rem',
        sm: '0.75rem',
        base: '0.8125rem',
        lg: '0.875rem',
        xl: '1rem',
        '2xl': '1.1875rem',
        '3xl': '1.375rem',
        '4xl': '1.625rem',
      },
      // ── State / wash scale (2 / 4 / 6 / 8 / 10 / 16 / 20 %) ───────────────
      // Borders, hovers, selected rows and sunken fills are all `white` (the
      // adaptive wash) at some alpha. That alpha had TWENTY-NINE distinct values
      // — 0.012, 0.015, 0.018, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05,
      // 0.055 … — differences nobody can see and everybody had to re-decide.
      // These seven steps are the whole vocabulary. Write `white/6`, never
      // `white/[0.06]`: an off-scale value then still needs brackets and stands
      // out in review.
      //   2  — sunken fill (inset wells, deleted bubbles)
      //   4  — subtle fill, faint dividers
      //   6  — hairline border, row hover
      //   8  — default border
      //   10 — hover surface, selected row
      //   16 — strong border, active/pressed
      //   20 — focus rings (the one emphasis step; see focus-visible:ring-white/20)
      // Only the fine steps are defined here — 10 and 20 already exist in
      // Tailwind's default 0–100/step-5 opacity scale.
      // NOT part of this scale: `pure-white/*` (literal white text on media
      // overlays) and solid marker glyphs, which are content, not surface wash.
      opacity: {
        2: '0.02',
        4: '0.04',
        6: '0.06',
        8: '0.08',
        16: '0.16',
      },
      // ── Elevation scale ──────────────────────────────────────────────────
      // Fourteen one-off inline shadows collapse to four roles. `drawer` stays
      // separate rather than folding into `modal` because it is DIRECTIONAL —
      // side panels cast left, everything else casts down.
      //   raised  — floating controls attached to a surface (composer, map pills)
      //   overlay — menus, popovers, dropdowns, search
      //   modal   — dialogs and auth cards
      //   drawer  — right-hand side panels (Group info, profile, add trip)
      boxShadow: {
        raised: '0 4px 14px rgba(0, 0, 0, 0.40)',
        overlay: '0 10px 30px rgba(0, 0, 0, 0.45)',
        modal: '0 24px 70px rgba(0, 0, 0, 0.55)',
        drawer: '-16px 0 48px rgba(0, 0, 0, 0.40)',
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
