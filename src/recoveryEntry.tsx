import { createRoot } from 'react-dom/client'
import { consumeRecoveryHash, recoveryEnabled } from './passwordRecovery'
import { RecoveryPage } from './PasswordRecoveryPage'
import './recovery.css'

// Never import App/cloud/storage/analytics or start a service worker on this route.
const enabled = recoveryEnabled()
const hadUrlData = Boolean(location.hash || location.search)
let pendingToken = consumeRecoveryHash(location.hash, () => history.replaceState(null, '', location.pathname), location.search)
if (!enabled) pendingToken = null
const takeInitialToken = () => { const result = pendingToken; pendingToken = null; return result }

if (window.self === window.top) createRoot(document.getElementById('root')!).render(
  <RecoveryPage enabled={enabled} hadUrlData={hadUrlData} takeInitialToken={takeInitialToken}/>
)
else { pendingToken = null; document.body.textContent = '請直接開啟一刻手帳網址，以使用帳號功能。' }
