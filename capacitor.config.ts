import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.qqchen.inkday',
  appName: '一刻手帳 Yike',
  webDir: 'dist',
  ios: {
    // never：WebView 不自動加 inset，安全區改由 CSS env(safe-area-inset-*) 控制（最貼合）
    contentInset: 'never',
    backgroundColor: '#f5f0e6',
  },
}

export default config
