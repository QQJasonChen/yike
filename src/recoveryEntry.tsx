import { createRoot } from 'react-dom/client'
import { consumeRecoveryHash, passwordRecovery, RECOVERY_REDIRECT_URL } from './passwordRecovery'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig'
import { RecoveryPage } from './PasswordRecoveryPage'
import { makeProofOnlyRecovery } from './recoveryCanary'
import './recovery.css'

// This standalone payload is a proposal requiring separate canonical-deploy
// approval. No App/cloud/storage/analytics/SW registration is imported.
const hadUrlData = Boolean(location.hash || location.search)
let pendingToken = consumeRecoveryHash(location.hash,
  () => history.replaceState(null, '', location.pathname), location.search)
const canonical = location.origin === 'https://yikeday.com' &&
  ['/recover', '/recover.html'].includes(location.pathname)
const topLevel = window.self === window.top
// Public requests are a separate, explicit release switch. With the default OFF,
// canonical mail proof keeps the existing transport that cannot request email.
const requestEnabled = canonical && topLevel && import.meta.env.VITE_ACCOUNT_RECOVERY_ENABLED === 'true'
const enabled = canonical && topLevel && (requestEnabled || Boolean(pendingToken))
if (!enabled) pendingToken = null
const takeInitialToken = () => { const value = pendingToken; pendingToken = null; return value }

if (topLevel) createRoot(document.getElementById('root')!).render(
  <RecoveryPage enabled={enabled} requestEnabled={requestEnabled} hadUrlData={hadUrlData}
    takeInitialToken={takeInitialToken} createRecovery={() => requestEnabled
      ? passwordRecovery({ enabled, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, redirectTo: RECOVERY_REDIRECT_URL })
      : makeProofOnlyRecovery(enabled)}/>
)
else { pendingToken = null; document.body.textContent = '請直接開啟一刻手帳網址，以使用帳號功能。' }
