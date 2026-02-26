/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-active': 'var(--color-surface-active)',
        border: 'var(--color-border)',
        'border-subtle': 'var(--color-border-subtle)',
        foreground: 'var(--color-text)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        positive: 'var(--color-positive)',
        'positive-bg': 'var(--color-positive-bg)',
        negative: 'var(--color-negative)',
        'negative-bg': 'var(--color-negative-bg)',
        warning: 'var(--color-warning)',
        'warning-bg': 'var(--color-warning-bg)',
        info: 'var(--color-info)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],   // 11px
        xs: ['0.75rem', { lineHeight: '1rem' }],         // 12px
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],    // 13px (base)
        base: ['0.875rem', { lineHeight: '1.375rem' }],  // 14px
        lg: ['1rem', { lineHeight: '1.5rem' }],          // 16px
        xl: ['1.125rem', { lineHeight: '1.75rem' }],     // 18px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],       // 24px
      },
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '2.5': '10px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        'sidebar': '48px',
        'topbar': '40px',
        'statusbar': '24px',
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'slide-in': 'slideIn 150ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
