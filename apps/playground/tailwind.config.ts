/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shared with the single-file build (apps/single/template.html).
        ink: {
          950: '#0b0d11',
          900: '#14181f',
          850: '#1a1f28',
          800: '#20262f',
          700: '#252c38',
          600: '#333c4d',
        },
        gold: {
          300: '#f5c242',
          400: '#f0c75e',
          500: '#e0ae2b',
          600: '#b98a16',
        },
        ok: { bg: '#141f19', line: '#2c5c42', fg: '#4ade80' },
        warn: { bg: '#241f0d', line: '#6b5a1e', fg: '#f5c242' },
        err: { bg: '#241a18', line: '#5c3330', fg: '#ff6b6b' },
        fg: { DEFAULT: '#e8eaf0', 2: '#9aa3b2', 3: '#6b7484' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
