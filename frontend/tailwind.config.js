/** "Neo-Brutalist Retail OS": Archival paper #FAF9F5, crisp black borders, electric lime #CCFF00 accents, and hard offset shadows. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', full: '9999px' },
    boxShadow: {
      none: 'none',
      hard: '4px 4px 0 #1A1A1A',
      'hard-sm': '2px 2px 0 #1A1A1A',
      'hard-lg': '8px 8px 0 #1A1A1A',
      'hard-lime': '3px 3px 0 #CCFF00',
      'hard-indigo': '3px 3px 0 #4F46E5',
    },
    extend: {
      colors: {
        paper: '#FAF9F5',
        sheet: '#FFFFFF',
        ink: '#1A1A1A',
        muted: '#4B5563',
        hair: '#E5E7EB',
        tint: '#F3F4F6',
        neon: '#CCFF00',
        brick: '#BE123C',
        olive: '#15803D',
        ochre: '#B45309',
        navy: '#4F46E5',
        'paper-cool': '#EFF6FF',
        'tint-cool': '#DBEAFE',
        'navy-dark': '#1E1B4B',
        'navy-light': '#EEF2FF',
        'teal': '#0E7490',
        'teal-light': '#CFFAFE',
        'slate-cool': '#475569',
      },
      fontFamily: {
        serif: ['Merriweather', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['"Fira Code"', '"JetBrains Mono"', 'Consolas', '"Courier New"', 'monospace'],
        sans: ['system-ui', '"Segoe UI"', 'Arial', 'sans-serif'],
      },
      fontSize: { base: ['14px', '1.4'] },
    },
  },
  plugins: [],
};
