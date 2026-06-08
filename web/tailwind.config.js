/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        surface: '#141416',
        'surface-2': '#1d1d20',
        // Sidebar + headers ("rail"). Matched to the message-bubble grey
        // (own-message bubble #1C1C1F in MessageRow) so the chrome reads as a
        // clearly-visible grey, distinct from the pure-black chat window, while
        // staying consistent with the bubbles. Bubble text is #F4F1EC = `text`,
        // which the rail already uses.
        rail: '#1c1c1f',
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
