/** "Utilitarian Archivist": paper and ink, 1px hard borders, no radius, no soft shadows. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', full: '9999px' },
    boxShadow: { none: 'none', hard: '4px 4px 0 #1A1A1A', 'hard-sm': '2px 2px 0 #C9C5B8' },
    extend: {
      colors: {
        paper: '#F5F4F0', sheet: '#FFFFFF', ink: '#1A1A1A', muted: '#5E5B54', hair: '#C9C5B8', tint: '#ECEAE3',
        brick: '#9B2C2C', olive: '#3F6B3A', ochre: '#8A6A12', navy: '#2F4A6B',
      },
      fontFamily: {
        serif: ['Merriweather', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['"Fira Code"', '"JetBrains Mono"', 'Consolas', '"Courier New"', 'monospace'],
        sans: ['system-ui', '"Segoe UI"', 'Arial', 'sans-serif'],
      },
      fontSize: { base: ['14px', '1.35'] },
    },
  },
  plugins: [],
};
