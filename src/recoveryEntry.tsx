import { createRoot } from 'react-dom/client'
import { consumeRecoveryHash } from './passwordRecovery'
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
const enabled = canonical && Boolean(pendingToken)
if (!enabled) pendingToken = null
const takeInitialToken = () => { const value = pendingToken; pendingToken = null; return value }

if (window.self === window.top) createRoot(document.getElementById('root')!).render(
  <RecoveryPage enabled={enabled} requestEnabled={false} hadUrlData={hadUrlData}
    takeInitialToken={takeInitialToken} createRecovery={() => makeProofOnlyRecovery(enabled)}/>
)
else { pendingToken = null; document.body.textContent = '請直接開啟一刻手帳網址，以使用帳號功能。' }
