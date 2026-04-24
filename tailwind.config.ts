import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pulse: {
          bg: '#0a0b10',
          panel: '#11131c',
          border: '#1f2330',
          ink: '#e6e8ef',
          muted: '#8a90a2',
          accent: '#6ee7ff',
          danger: '#ff5d7a',
          warn: '#ffb347',
          ok: '#7ee8a6'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
