import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecoveryPage, type RecoveryPageProps } from '../PasswordRecoveryPage'
import type { Root } from 'react-dom/client'

const mounted = vi.hoisted(() => ({ create: vi.fn(), render: vi.fn(), clear: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: mounted.create }))
const { createRoot: realCreateRoot } = await vi.importActual<typeof import('react-dom/client')>('react-dom/client')
const proof = 'abcdef0123456789'.repeat(4)
let root: Root | undefined
let host: HTMLDivElement | undefined
const fetcher = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_ACCOUNT_RECOVERY_ENABLED', '')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('history', { replaceState: mounted.clear })
  mounted.create.mockReset().mockReturnValue({ render: mounted.render })
  mounted.render.mockReset(); mounted.clear.mockReset(); fetcher.mockReset()
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined; host?.remove(); host = undefined
  vi.unstubAllGlobals(); vi.unstubAllEnvs()
})
async function boot(flag = '', hash = '', origin = 'https://yikeday.com', pathname = '/recover.html') {
  vi.stubEnv('VITE_ACCOUNT_RECOVERY_ENABLED', flag)
  vi.stubGlobal('location', { hash, search: '', origin, pathname })
  await import('../recoveryEntry')
  return mounted.render.mock.calls[mounted.render.mock.calls.length - 1]?.[0].props as RecoveryPageProps
}
async function show(props: RecoveryPageProps) {
  host = document.createElement('div'); document.body.append(host)
  root = realCreateRoot(host)
  await act(async () => root!.render(<RecoveryPage {...props}/>))
}

it('default remains off, without a request form or network', async () => {
  const props = await boot()
  expect(props.requestEnabled).toBe(false)
  await show(props)
  expect(host!.querySelectorAll('input,button')).toHaveLength(0)
  expect(fetcher).not.toHaveBeenCalled()
})
it('explicit enabled canonical entry offers mail only after a user submits', async () => {
  const props = await boot('true')
  expect(props.enabled).toBe(true); expect(props.requestEnabled).toBe(true)
  await show(props)
  expect(fetcher).not.toHaveBeenCalled()
  const input = host!.querySelector<HTMLInputElement>('input[type=email]')!
  expect(input).not.toBeNull()
  fetcher.mockResolvedValue(new Response('{}', { status: 200 }))
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'synthetic@example.invalid')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => host!.querySelector('button')!.click())
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe('/auth/v1/recover')
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('redirect_to')).toBe('https://yikeday.com/recover.html')
})
it('default with valid proof still cannot request mail through its actual API', async () => {
  const props = await boot('', `#token_hash=${proof}&type=recovery`)
  expect(props.enabled).toBe(true); expect(props.requestEnabled).toBe(false)
  await expect(props.createRecovery!().requestReset('synthetic@example.invalid')).rejects.toThrow('尚未開放')
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['#token_hash=short&type=recovery', '#access_token=SYNTHETIC&type=recovery', `#token_hash=${proof}&type=recovery`])('enabled entry clears URL and does not auto request/verify %s', async hash => {
  const props = await boot('true', hash)
  expect(mounted.clear).toHaveBeenCalledWith(null, '', '/recover.html')
  expect(mounted.clear.mock.invocationCallOrder[0]).toBeLessThan(mounted.create.mock.invocationCallOrder[0])
  await show(props)
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([
  ['true', 'https://yikeday.pages.dev', '/recover.html'],
  ['true', 'https://yikeday.com', '/other'],
  ['TRUE', 'https://yikeday.com', '/recover.html'],
])('does not offer public recovery with flag %s at %s%s', async (flag, origin, path) => {
  const props = await boot(flag, '', origin, path)
  expect(props.enabled).toBe(false); expect(props.requestEnabled).toBe(false)
  await show(props)
  expect(host!.querySelectorAll('input,button')).toHaveLength(0)
  expect(fetcher).not.toHaveBeenCalled()
})
it('explicit flag never enables an iframe credential UI', async () => {
  vi.stubGlobal('window', { self: {}, top: {} })
  await boot('true', `#token_hash=${proof}&type=recovery`)
  expect(mounted.create).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('請直接開啟')
})
