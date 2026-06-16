/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 自訂網域 yikeday.com 從根目錄服務；Capacitor (iOS) 需要相對路徑
export default defineConfig({
  base: process.env.CAP_BUILD ? './' : process.env.PAGES_BASE || '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
