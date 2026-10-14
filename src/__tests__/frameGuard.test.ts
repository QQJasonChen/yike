import { describe, expect, it } from 'vitest'
import { guardFraming, isFramed, renderFrameWarning } from '../frameGuard'

describe('client framing mitigation', () => {
  it('same window is allowed, different or inaccessible top is blocked', () => {
    const own = {}
    expect(isFramed({ top: own, self: own })).toBe(false)
    expect(isFramed({ top: {}, self: own })).toBe(true)
    expect(isFramed({ get top() { throw new Error('cross origin') }, self: own })).toBe(true)
  })
  it('guard never attempts navigation, even when top location is writable', () => {
    const top = { location: 'https://parent.invalid/' }
    expect(guardFraming({ top, self: { location: 'https://yikeday.com/' } })).toBe(true)
    expect(top.location).toBe('https://parent.invalid/')
  })
  it('warning removes existing UI and offers only the fixed manual link without a security guarantee', () => {
    const root = document.createElement('div')
    root.innerHTML = '<input value="synthetic-private-ui">'
    renderFrameWarning(root)
    expect(root.querySelector('input')).toBeNull()
    expect(root.querySelector('a')!.href).toBe('https://yikeday.com/')
    expect(root.querySelector('a')!.rel).toBe('noopener noreferrer')
    expect(root.textContent).not.toContain('自己的網域上才安全')
    expect(root.textContent).not.toContain('synthetic-private-ui')
  })
})
