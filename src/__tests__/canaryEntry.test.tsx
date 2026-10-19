import { afterEach,beforeEach,expect,it,vi } from 'vitest'
const calls=vi.hoisted(()=>({create:vi.fn(),render:vi.fn(),clear:vi.fn()}))
vi.mock('react-dom/client',()=>({createRoot:calls.create}))
const proof='abcdef0123456789'.repeat(4)
beforeEach(()=>{
  vi.resetModules();calls.create.mockReset().mockReturnValue({render:calls.render});calls.render.mockReset();calls.clear.mockReset()
  document.body.innerHTML='<div id="root"></div>'
  vi.stubGlobal('history',{replaceState:calls.clear})
})
afterEach(()=>vi.unstubAllGlobals())
async function boot(hash:string,origin='https://yikeday.com',search=''){
  vi.stubGlobal('location',{hash,search,origin,pathname:'/recover.html'})
  await import('../recoveryEntry')
}
it('actual entry clears canonical URL before mounting and transfers proof only once',async()=>{
  await boot('#token_hash='+proof+'&type=recovery')
  expect(calls.clear).toHaveBeenCalledWith(null,'','/recover.html')
  expect(calls.clear.mock.invocationCallOrder[0]).toBeLessThan(calls.create.mock.invocationCallOrder[0])
  const props=calls.render.mock.calls[0][0].props
  expect(props.enabled).toBe(true);expect(props.requestEnabled).toBe(false)
  expect(props.takeInitialToken()).toBe(proof);expect(props.takeInitialToken()).toBeNull()
})
it.each(['','#access_token=SYNTHETIC&type=recovery','#token_hash=short&type=recovery','#token_hash='+proof+'&type=signup'])('actual entry rejects %s without a request form',async(hash)=>{
  await boot(hash);const props=calls.render.mock.calls[0][0].props
  expect(props.enabled).toBe(false);expect(props.requestEnabled).toBe(false);expect(props.takeInitialToken()).toBeNull()
})
it('preview origin and query credentials are cleared but cannot enable recovery',async()=>{
  for(const [origin,search] of [['https://yikeday.pages.dev',''],['https://yikeday.com','?code=synthetic']]){
    vi.resetModules();await boot('#token_hash='+proof+'&type=recovery',origin,search)
    const props=calls.render.mock.calls[calls.render.mock.calls.length-1][0].props;expect(props.enabled).toBe(false);expect(props.takeInitialToken()).toBeNull()
  }
})
it('framed actual entry never mounts a credential UI',async()=>{
  vi.stubGlobal('window',{self:{},top:{}})
  await boot('#token_hash='+proof+'&type=recovery')
  expect(calls.create).not.toHaveBeenCalled();expect(document.body.textContent).toContain('請直接開啟')
})
