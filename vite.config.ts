import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Introweek-app/',
  build: {
    target: 'es2022',
    cssCodeSplit: false,
  },
})
