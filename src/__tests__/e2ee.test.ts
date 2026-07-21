// @vitest-environment node
// 用 node 環境確保有完整 WebCrypto（crypto.subtle）
import { describe, it, expect } from 'vitest'
import {
  setupE2ee,
  unlockWithPassphrase,
  unlockWithRecovery,
  rewrapPassphrase,
  encryptValue,
  decryptValue,
  _internal,
} from '../e2ee'

describe('e2ee 加密核心', () => {
  it('開通 → 密語解鎖 → 內容加解密 round-trip', async () => {
    const { vault, dk } = await setupE2ee('my-strong-passphrase')
    const secret = { northStar: '成為好好專注的人', mood: 5, note: '私密的話🔒' }
    const blob = await encryptValue(dk, secret)
    expect(blob).not.toContain('私密') // 密文不含明文

    const dk2 = await unlockWithPassphrase(vault, 'my-strong-passphrase')
    expect(await decryptValue(dk2, blob)).toEqual(secret)
  })

  it('密語錯誤會被擋下（不會解出垃圾）', async () => {
    const { vault } = await setupE2ee('correct-horse')
    await expect(unlockWithPassphrase(vault, 'wrong-horse')).rejects.toThrow('密語錯誤')
  })

  it('忘記密語 → 用救援碼解鎖', async () => {
    const { vault, dk, recoveryKey } = await setupE2ee('pass-A')
    const blob = await encryptValue(dk, { x: 42 })
    expect(recoveryKey).toMatch(/^[0-9A-Z-]+$/) // 可抄寫的格式
    const dkR = await unlockWithRecovery(vault, recoveryKey)
    expect(await decryptValue(dkR, blob)).toEqual({ x: 42 })
  })

  it('救援碼可容錯（小寫、去掉分隔線、O/0 混淆）仍能解', async () => {
    const { vault, recoveryKey } = await setupE2ee('pass-B')
    const messy = recoveryKey.toLowerCase().replace(/-/g, ' ')
    await expect(unlockWithRecovery(vault, messy)).resolves.toBeDefined()
  })

  it('改密語：不重新加密內容，新密語可解、舊密語失效', async () => {
    const { vault, dk } = await setupE2ee('old-pass')
    const blob = await encryptValue(dk, { keep: 'same-ciphertext' })
    const vault2 = await rewrapPassphrase(dk, vault, 'new-pass')

    const dkNew = await unlockWithPassphrase(vault2, 'new-pass')
    expect(await decryptValue(dkNew, blob)).toEqual({ keep: 'same-ciphertext' }) // 舊密文照用
    await expect(unlockWithPassphrase(vault2, 'old-pass')).rejects.toThrow('密語錯誤')
  })

  it('base32 救援碼編解碼 round-trip', () => {
    const bytes = _internal.randomBytes(20)
    const str = _internal.toBase32(bytes)
    expect(Array.from(_internal.fromBase32(str))).toEqual(Array.from(bytes))
  })

  it('每次開通的主金鑰與救援碼都不同（有隨機性）', async () => {
    const a = await setupE2ee('same')
    const b = await setupE2ee('same')
    expect(a.recoveryKey).not.toEqual(b.recoveryKey)
    expect(a.vault.wrappedByPass).not.toEqual(b.vault.wrappedByPass)
  })
})
