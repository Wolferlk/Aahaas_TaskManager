import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
          ink: 'rgb(var(--brand-ink) / <alpha-value>)',
        },
      },
      borderRadius: { xl: '0.875rem', '2xl': '1rem', '3xl': '1.25rem' },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        pop: '0 10px 30px -12px rgb(15 23 42 / 0.25), 0 4px 12px -6px rgb(15 23 42 / 0.12)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.25), 0 8px 24px -8px rgb(var(--brand) / 0.45)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(.97)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        // A card that arrives with a little overshoot rather than just appearing.
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(.96)' },
          '60%': { opacity: '1', transform: 'translateY(-2px) scale(1.01)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        // Slow vertical drift, for the decorative blobs behind a hero.
        float: {
          '0%,100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-10px) rotate(3deg)' },
        },
        // Sweeps a brand gradient across a heading or a progress bar.
        'gradient-pan': {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        // The nudge an empty state gives when it wants attention.
        wiggle: {
          '0%,100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-7deg)' },
          '75%': { transform: 'rotate(7deg)' },
        },
        // A soft heartbeat for "today is still unrecorded".
        'pulse-soft': {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '.75', transform: 'scale(1.06)' },
        },
        // A widening halo, used once when something is completed.
        ripple: {
          '0%': { transform: 'scale(.85)', opacity: '.6' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        // Fills a bar from nothing to its measured width.
        grow: { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        // A single celebratory hop.
        'bounce-in': {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '55%': { transform: 'scale(1.18)', opacity: '1' },
          '80%': { transform: 'scale(.94)' },
          '100%': { transform: 'scale(1)' },
        },
        twinkle: {
          '0%,100%': { opacity: '.3', transform: 'scale(.8)' },
          '50%': { opacity: '1', transform: 'scale(1.15)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.16,1,.3,1) both',
        'slide-in': 'slide-in .28s cubic-bezier(.16,1,.3,1) both',
        'scale-in': 'scale-in .18s cubic-bezier(.16,1,.3,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pop-in': 'pop-in .45s cubic-bezier(.16,1,.3,1) both',
        float: 'float 7s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 6s ease infinite',
        wiggle: 'wiggle .6s ease-in-out',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        ripple: 'ripple 1.8s ease-out infinite',
        grow: 'grow .8s cubic-bezier(.16,1,.3,1) both',
        'bounce-in': 'bounce-in .5s cubic-bezier(.16,1,.3,1) both',
        twinkle: 'twinkle 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
