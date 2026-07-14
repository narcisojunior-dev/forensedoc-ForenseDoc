/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta baseada em um tema Dark Premium B2B (Legal Tech)
        // Fundo escuro (slate), detalhes em ouro/âmbar (tradicional do direito) ou neon azul (IA/Tech)
        background: '#09090b', // zinc-950
        foreground: '#fafafa', // zinc-50
        primary: {
          DEFAULT: '#3b82f6', // blue-500
          foreground: '#ffffff',
          hover: '#2563eb', // blue-600
        },
        secondary: {
          DEFAULT: '#27272a', // zinc-800
          foreground: '#fafafa',
          hover: '#3f3f46', // zinc-700
        },
        accent: {
          DEFAULT: '#f59e0b', // amber-500 (dourado tech)
          foreground: '#0f172a',
        },
        surface: {
          DEFAULT: '#18181b', // zinc-900 (cards)
          foreground: '#fafafa',
          border: '#27272a', // zinc-800
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
