import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { cloudEnabled } from './cloudConfig'
import { closeSyncGate, hasCloudArtifact } from './storage'

// 拉取優先：若這台曾登入雲端，render 前先關上同步閘門，
// 擋掉「首次 pull 完成前」的任何本機寫入污染雲端時間戳。cloud.ts 同步完成後打開。
if (cloudEnabled() && hasCloudArtifact()) closeSyncGate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// 離線支援：註冊 service worker（僅在正式環境）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
