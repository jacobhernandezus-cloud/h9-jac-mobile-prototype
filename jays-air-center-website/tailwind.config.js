/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
  ],
  theme: {
    extend: {
      colors: {
        'warm-white': '#F8F6F3',
        'soft-gray': '#E5E3DF',
        'pearl': '#F5F5F0',
        'charcoal': '#1A1A1A',
        'deep-navy': '#1B2838',
        'burnished-gold': '#C9A55B',
        'champagne': '#E8DCC4',
        'sky-blue': '#4A90A4',
      },
      fontFamily: {
        'logo': ['Cinzel', 'serif'],
        'heading': ['Cormorant', 'serif'],
        'body': ['DM Sans', 'sans-serif'],
      },
      letterSpacing: {
        'logo': '0.35em',
        'wide': '0.1em',
      },
    },
  },
  plugins: [],
}
