/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── One field, two hairlines ─────────────────────────────────────────
        // Values live in index.css (:root) — that file is the source of truth
        // and carries the full note; these are just the names.
        //
        // The 2026-08-20 rework retired the six-step surface ladder. There is
        // now ONE field colour (black in dark, white in light) and every
        // separation in the app is a 1px rule. Reach for a border, never a tone
        // step, and never a shadow.
        //
        // bg — the field. Also the contrasting foreground placed on accent
        //      chips/buttons (`text-bg`).
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        // sidebar / chat / panel / rail / composer / bubble-own — all aliases of
        // `bg`, kept only so the existing call sites keep resolving while the
        // rework lands surface by surface. NEW CODE WRITES `bg-bg`.
        sidebar: 'rgb(var(--color-sidebar) / <alpha-value>)',
        chat: 'rgb(var(--color-chat) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        rail: 'rgb(var(--color-rail) / <alpha-value>)',
        composer: 'rgb(var(--color-composer) / <alpha-value>)',
        'bubble-own': 'rgb(var(--color-bubble-own) / <alpha-value>)',
        // The two survivors of the ladder, and the ONLY legitimate tone steps:
        // surface   — floating chrome that covers content it must stay
        //             distinguishable from (menus, dropdowns, popovers, modal
        //             sheets). An inline surface must never use it.
        // surface-2 — the hover / selected wash. A state, not a layer.
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--color-surface-2) / <alpha-value>)',
        // ── The hairlines ───────────────────────────────────────────────────
        // line   — every structural rule: panel edges, block borders, dividers,
        //          the left rule of an incoming message.
        // line-2 — the emphasis rule (~2.5× the contrast): the left rule of my
        //          own messages, active/selected edges, focused inputs.
        // Available as `border-line` / `bg-line` (hairline divs) / `text-line`.
        line: 'rgb(var(--color-line) / <alpha-value>)',
        'line-2': 'rgb(var(--color-line-2) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        // Secondary / tertiary text:
        //   muted — assistant/incoming body copy, secondary labels, meta.
        //   faint — mono eyebrows, timestamps, hints, placeholders.
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        faint: 'rgb(var(--color-faint) / <alpha-value>)',
        done: 'rgb(var(--color-done) / <alpha-value>)',
        active: 'rgb(var(--color-active) / <alpha-value>)',
        alert: 'rgb(var(--color-alert) / <alpha-value>)',
        // The travelled-path teal, as TEXT. The map draws that path in a fixed
        // teal (hereMapIcons ROUTE/trail colours) which the legend swatch must
        // match exactly to identify the line — but that same value is far too
        // light to read as small text on a light panel, so the text token is
        // the same hue darkened for the light theme. Swatch and readout
        // therefore agree in hue while each stays legible on its own surface.
        driven: 'rgb(var(--color-driven) / <alpha-value>)',
        // `white` is the adaptive contrast wash used by hovers and selected
        // rows: white in dark mode, black in light mode. BORDERS no longer use
        // it — they use `line` / `line-2`, which are solid so two hairlines
        // meeting at a corner can't compound into a heavier double rule.
        // Media/PDF surfaces that must remain literally white use pure-white.
        white: 'rgb(var(--color-wash) / <alpha-value>)',
        'pure-white': '#ffffff',
      },
      // Bare `border` is the hairline. `border-strong` is the emphasis rule.
      // The rule down my own messages is --color-line-own, written at the call
      // site as an arbitrary value rather than added here: a name in this file
      // only exists after every running dev server has reloaded the config,
      // which is a poor trade for one call site in one component.
      // `border-light` is a deprecated alias of the hairline, kept so untouched
      // call sites still land on the scale — don't write it in new code.
      borderColor: {
        DEFAULT: 'rgb(var(--color-line) / <alpha-value>)',
        strong: 'rgb(var(--color-line-2) / <alpha-value>)',
        light: 'rgb(var(--color-line) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        // The mono face carries a real share of this UI — every eyebrow,
        // attribution row, chip, stat value and hint is set in it — so it is a
        // loaded webfont rather than whatever `ui-monospace` resolves to, which
        // differs per OS and would make the same screen read differently on
        // Windows and macOS.
        mono: ['"JetBrains Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
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
      // on 2K/4K displays, same as the radius scale. Chat/sidebar/thread text
      // does NOT use this scale — it stays on the px tokens
      // (--chat-msg-font-size, --sidebar-*, --msg-*, --stat-value-size) so it
      // can be tuned per display tier.
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
      // ── State wash scale (2 / 4 / 6 / 8 / 10 / 16 / 20 %) ─────────────────
      // Hovers, selected rows and sunken fills are `white` (the adaptive wash)
      // at some alpha. That alpha had TWENTY-NINE distinct values — 0.012,
      // 0.015, 0.018, 0.02, 0.025, 0.03 … — differences nobody can see and
      // everybody had to re-decide. These steps are the whole vocabulary.
      // Write `bg-white/6`, never `bg-white/[0.06]`.
      //   2  — sunken fill (inset wells, deleted rows)
      //   4  — subtle fill
      //   6  — row hover
      //   8  — pressed row
      //   10 — selected row
      //   16 — active/pressed emphasis
      //   20 — focus rings (see focus-visible:ring-white/20)
      // BORDERS are no longer part of this scale — see `line` / `line-2`.
      // NOT part of it either: `pure-white/*` (literal white text on media
      // overlays) and solid marker glyphs, which are content, not surface wash.
      opacity: {
        2: '0.02',
        4: '0.04',
        6: '0.06',
        8: '0.08',
        16: '0.16',
      },
      // ── Elevation ────────────────────────────────────────────────────────
      // Almost gone. The rework's rule is that nothing INLINE casts a shadow —
      // panels, cards, the composer, message blocks and stat grids are drawn by
      // their hairline and nothing else, so `raised` is now literally none and
      // the 17 `shadow-raised` call sites flatten without being touched.
      // Only chrome that genuinely FLOATS over other content keeps one, and
      // then only enough to prove it is detached, since `surface` is a bare two
      // steps off the field:
      //   overlay — menus, popovers, dropdowns
      //   modal   — dialogs and auth cards
      //   drawer  — right-hand side panels (directional: they cast left)
      boxShadow: {
        raised: 'none',
        overlay: '0 8px 24px rgb(0 0 0 / 0.28)',
        modal: '0 16px 48px rgb(0 0 0 / 0.34)',
        drawer: '-12px 0 32px rgb(0 0 0 / 0.24)',
      },
      // ── Radius scale — square ─────────────────────────────────────────────
      // The rework is a drawn, sharp-cornered design: a hairline grid reads as a
      // grid only if the rules actually meet at corners, and a 6px round on a
      // 1px rule just makes the corner look unfinished. Every role therefore
      // resolves to 0.
      //
      // The NAMES survive on purpose. Keeping `rounded-card` etc. means the ~90
      // existing call sites square themselves without a mechanical find/replace
      // across the whole app, and the roles stay meaningful if a future surface
      // wants its corners back — one value here, not ninety in components.
      //   chip / btn / card / modal / panel / soft
      // Circular icon buttons still use rounded-full (ICON_ACTION_* in
      // HeaderIconButton.tsx) — a round hover target is a control affordance,
      // not a card corner.
      borderRadius: {
        chip: '0',
        btn: '0',
        card: '0',
        modal: '0',
        panel: '0',
        soft: '0',
      },
      letterSpacing: {
        // The mono voice. Every uppercase mono label in the app — eyebrows,
        // message attribution rows, stat labels, chips, hints — uses `eyebrow`;
        // `badge` is the tighter step for mono set at reading size.
        eyebrow: '0.14em',
        badge: '0.07em',
      },
      maxWidth: {
        // The reading measures, mirroring --thread-width / --msg-body so a
        // component can write `max-w-body` instead of restating the number.
        thread: 'var(--thread-width)',
        body: 'var(--msg-body)',
      },
    },
  },
  plugins: [],
}
