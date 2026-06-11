import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /productivity-planner/
export default defineConfig({
  base: '/productivity-planner/',
  plugins: [react()],
})
