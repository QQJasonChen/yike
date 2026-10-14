import './styles.css'
import { guardFraming, renderFrameWarning } from './frameGuard'

const root = document.getElementById('root')!

const boot = async (): Promise<void> => {
  // Defer application/storage/widget module execution until after the framing guard.
  const [{ StrictMode }, { createRoot }, { default: App }, { cloudEnabled }, storage] = await Promise.all([
    import('react'), import('react-dom/client'), import('./App'), import('./cloudConfig'), import('./storage'),
  ])
  // Keep the normal startup order: stamp known legacy owner, close sync gate, mount.
  storage.stampLegacyBackupOwners()
  if (cloudEnabled() && storage.hasCloudArtifact()) storage.closeSyncGate()
  await import('./widgetSync') // native widget bridge (web no-op)
  createRoot(root).render(<StrictMode><App /></StrictMode>)

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const register = () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}) }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }
  await import('./analytics').then((module) => module.countPageview())
}

// Export the real startup promise so tests can await this entry module's actual effects.
export const startup = guardFraming()
  ? (renderFrameWarning(root), Promise.resolve())
  : boot()
void startup.catch(() => { root.textContent = '一刻手帳載入未完成，請重新整理後再試。' })
