import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        terracotta: {
          DEFAULT: '#B44C30',
          dark: '#8A3A23',
          light: '#D4694A',
        },
        mustard: {
          DEFAULT: '#D4A017',
          dark: '#A87D12',
          light: '#E8B82A',
        },
        ink: {
          DEFAULT: '#1A1A1A',
          soft: '#2D2D2D',
          muted: '#3D3D3D',
        },
        cream: {
          DEFAULT: '#F5EDD6',
          dark: '#E8DFC4',
          muted: '#C8B89A',
        },
        market: {
          yes: '#4CAF50',
          no: '#F44336',
          'yes-dark': '#388E3C',
          'no-dark': '#C62828',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulseSlow 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'float-up': 'floatUp 1.2s ease-out forwards',
        'mine-click': 'mineClick 0.15s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        floatUp: {
          '0%': { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
          '100%': { opacity: '0', transform: 'translateX(-50%) translateY(-48px)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        mineClick: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.88)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
