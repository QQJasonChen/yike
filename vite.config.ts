/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /productivity-planner/；Capacitor (iOS) 需要相對路徑
export default defineConfig({
  base: process.env.CAP_BUILD ? './' : '/yike/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
