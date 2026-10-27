/** "Editorial Artisanal": warm paper, charcoal ink, accents drawn from physical materials (sage, terracotta, slate). */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '2px', sm: '2px', md: '3px', lg: '4px', xl: '6px', full: '9999px' },
    boxShadow: {
      none: 'none',
      // a sheet of paper resting on a desk, and a lifted dialog
      paper: '0 1px 0 rgba(43,40,37,.06), 0 8px 18px -12px rgba(43,40,37,.35)',
      dialog: '0 24px 48px -24px rgba(43,40,37,.55), 0 2px 0 rgba(43,40,37,.08)',
    },
    extend: {
      colors: {
        paper: '#F3EEE4', sheet: '#FAF7F0', ink: '#2B2825', muted: '#6F675C', line: '#D8CFBF', hair: '#E6DECF', tint: '#EBE4D6',
        sage: '#5E7253', terracotta: '#B0553A', slate: '#4F5D68', ochre: '#8A6A1F',
        // legacy names used across the pages, mapped onto the material palette
        brick: '#B0553A', olive: '#5E7253', navy: '#4F5D68',
        paper: '#F5F4F0', sheet: '#FFFFFF', ink: '#1A1A1A', muted: '#5E5B54', hair: '#C9C5B8', tint: '#ECEAE3',
        brick: '#9B2C2C', olive: '#3F6B3A', ochre: '#8A6A12', navy: '#2F4A6B',
        'paper-cool': '#EFF3F6', 'tint-cool': '#DFE6ED', 'navy-dark': '#182B3F',
        'navy-light': '#E8EEF5', 'teal': '#236966', 'teal-light': '#E7F3F2', 'slate-cool': '#4E6173',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '"Segoe UI"', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'], // figures use Inter with tabular numerals (see .font-mono in index.css)
      },
    },
  },
  plugins: [],
};
