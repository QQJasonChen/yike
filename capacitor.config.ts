import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.qqchen.inkday',
  appName: 'InkDay 日刻手帳',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f0e6',
  },
}

export default config
