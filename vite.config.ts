/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import { SUPABASE_URL } from './src/cloudConfig'
import react from '@vitejs/plugin-react'

// Web assets execute only first-party scripts. Native bridge policy is verified separately.
const firstPartyCsp: Plugin = {
  name: 'first-party-script-csp',
  transformIndexHtml: (html, ctx) => {
    if (process.env.CAP_BUILD) return html
    const authOrigin = new URL(SUPABASE_URL).origin
    const policy = ctx.path.endsWith('/recover.html')
      ? `default-src 'self'; script-src 'self'; style-src 'self'; connect-src ${authOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`
      : [
          "default-src 'self'", "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://yike.goatcounter.com",
          `connect-src 'self' ${authOrigin} ${authOrigin.replace('https:', 'wss:')} https://api.openai.com`,
          "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
        ].join('; ')
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
  },
}

// 自訂網域 yikeday.com 從根目錄服務；Capacitor (iOS) 需要相對路徑
export default defineConfig({
  base: process.env.CAP_BUILD ? './' : process.env.PAGES_BASE || '/',
  plugins: [react(), firstPartyCsp],
  build: { rollupOptions: { input: process.env.CAP_BUILD ? 'index.html' : { main: 'index.html', recovery: 'recover.html' } } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
