/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0B0B0D',
          900: '#121215',
          850: '#17171B',
          800: '#1E1E23',
          700: '#2A2A31',
          600: '#3A3A44',
        },
        gold: {
          300: '#F5D98B',
          400: '#F0C75E',
          500: '#E0AE2B',
          600: '#B98A16',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
