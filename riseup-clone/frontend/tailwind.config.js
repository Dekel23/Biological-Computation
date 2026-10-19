/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Rubik covers both Latin and Hebrew with matching metrics.
        sans: ['Rubik', 'system-ui', '-apple-system', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      colors: {
        // Semantic tokens defined as CSS variables in index.css (light + dark).
        surface: 'rgb(var(--surface) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
          ink: 'rgb(var(--brand-ink) / <alpha-value>)',
        },
        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px rgb(36 20 90 / 0.06)',
      },
      maxWidth: { app: '40rem' },
    },
  },
  plugins: [],
}
