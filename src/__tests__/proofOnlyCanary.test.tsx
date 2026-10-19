import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { RecoveryPage } from '../PasswordRecoveryPage'
import { makeProofOnlyRecovery, proofOnlyFetch } from '../recoveryCanary'
import { SUPABASE_URL } from '../cloudConfig'
const proof = 'abcdef0123456789'.repeat(4)
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid' }
const reply = (value: unknown, status=200) => new Response(JSON.stringify(value), { status })
let host: HTMLDivElement, root: Root
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host=document.createElement('div'); document.body.append(host);root=createRoot(host) })
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals() })
async function mount(fetcher: typeof fetch, initial: string|null=proof) {
  await act(async()=>root.render(<RecoveryPage enabled={Boolean(initial)} requestEnabled={false}
    takeInitialToken={()=>initial} createRecovery={()=>makeProofOnlyRecovery(Boolean(initial),fetcher)}/>))
}
async function click(){ await act(async()=>{host.querySelector('button')!.click()}) }
async function passwords(){ for(const input of host.querySelectorAll('input[type=password]')) await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'synthetic-new-password');input.dispatchEvent(new Event('input',{bubbles:true}))
}) }
it('plain canary has no form and makes no request',async()=>{
  const fetcher=vi.fn();await mount(fetcher,null)
  expect(host.querySelectorAll('input,button')).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled()
})
it('mail opening/scanner does not consume proof; only owner click verifies',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply({access_token:'SYNTHETIC',user})).mockResolvedValueOnce(reply(user))
  await mount(fetcher);expect(fetcher).not.toHaveBeenCalled();expect(host.querySelector('input')).toBeNull()
  await click();expect(fetcher).toHaveBeenCalledTimes(2);expect(host.querySelectorAll('input[type=password]')).toHaveLength(2)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({token_hash:proof,type:'recovery'})
})
it('real protocol confirms same owner, changes password, never reveals a mail form',async()=>{
  localStorage.setItem('pp:day:2026-10-15','synthetic existing draft');localStorage.setItem('sb-normal-session','synthetic existing session')
  const before=JSON.stringify(localStorage)
  const fetcher=vi.fn().mockResolvedValueOnce(reply({access_token:'SYNTHETIC',user})).mockResolvedValueOnce(reply(user)).mockResolvedValueOnce(reply(user)).mockResolvedValueOnce(reply({}))
  await mount(fetcher);await click();await passwords();await click()
  expect(host.textContent).toContain('密碼已更新');expect(host.querySelectorAll('input,button')).toHaveLength(0)
  expect(fetcher.mock.calls.map(c=>new URL(c[0]).pathname)).toEqual(['/auth/v1/verify','/auth/v1/user','/auth/v1/user','/auth/v1/logout'])
  expect(JSON.stringify(localStorage)).toBe(before)
})
it('expired link closes without a new email request path',async()=>{
  const fetcher=vi.fn().mockResolvedValue(reply({},403));await mount(fetcher);await click()
  expect(host.textContent).toContain('已失效');expect(host.querySelectorAll('input,button')).toHaveLength(0);expect(fetcher).toHaveBeenCalledOnce()
})
it('unknown password commit closes and does not retry or offer mail sending',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply({access_token:'SYNTHETIC',user})).mockResolvedValueOnce(reply(user)).mockRejectedValueOnce(Error('PRIVATE_NETWORK_BODY'))
  await mount(fetcher);await click();await passwords();await click()
  expect(host.textContent).toContain('結果尚未確認');expect(host.textContent).not.toContain('PRIVATE_NETWORK_BODY')
  expect(host.querySelectorAll('input,button')).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(3)
})
it('pagehide/bfcache cannot restore credential or request form',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply({access_token:'SYNTHETIC',user})).mockResolvedValueOnce(reply(user))
  await mount(fetcher);await click()
  await act(async()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))})
  expect(host.querySelectorAll('input,button')).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(2)
})
it('the canary API refuses mail even when directly invoked',async()=>{
  const fetcher=vi.fn();await expect(makeProofOnlyRecovery(true,fetcher).requestReset()).rejects.toThrow('尚未開放')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([
  ['/auth/v1/recover','POST'],['/auth/v1/signup','POST'],['/rest/v1/journal','GET'],
  ['/auth/v1/user','DELETE'],['/auth/v1/verify?redirect_to=other','POST'],['/auth/v1/logout?scope=local','POST'],
])('transport blocks %s %s before network',async(path,method)=>{
  const fetcher=vi.fn();await expect(proofOnlyFetch(fetcher)(SUPABASE_URL+path,{method})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()
})
it('transport blocks another origin',async()=>{
  const fetcher=vi.fn();await expect(proofOnlyFetch(fetcher)('https://other.invalid/auth/v1/user',{method:'PUT'})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()
})
