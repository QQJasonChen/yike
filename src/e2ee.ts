// 端對端加密核心（WebCrypto，零相依）。
//
// 架構（同 1Password / Proton）：
//   - 隨機「主金鑰」DK（256-bit）真正拿來加密所有同步內容。
//   - DK 用兩把鑰匙各包一份密文：①「密語衍生金鑰」②「救援碼」。
//     兩者皆可解出 DK；密語與救援碼都不上傳，伺服器只存 DK 的密文（無鑰即無用）。
//   - 好處：改密語只要重包 DK，不必重新加密全部資料；有兩條救援路徑。
//
// 威脅模型：伺服器（含專案擁有者）只看得到密文與 wrap 後的 DK。
// 沒有密語或救援碼，任何人（包含站方、包含 AI）都無法還原內容。
// 代價：密語與救援碼兩者皆遺失 → 資料永久無法還原（這正是 E2EE 的重點）。

const PBKDF2_ITER = 250_000
const te = new TextEncoder()
const td = new TextDecoder()

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

/** 由密語 + salt 衍生出一把 AES-GCM 包裝金鑰（PBKDF2-SHA256）。 */
const deriveWrapKey = async (secret: string, salt: Uint8Array): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 用某把金鑰做 AES-GCM 加密，回傳 base64(iv ‖ ciphertext)。 */
const aesEncrypt = async (key: CryptoKey, plain: Uint8Array): Promise<string> => {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), iv.length)
  return toB64(out)
}

/** 反向：解不開（金鑰錯／被竄改）會 throw（AES-GCM 驗證失敗）。 */
const aesDecrypt = async (key: CryptoKey, blobB64: string): Promise<Uint8Array> => {
  const raw = fromB64(blobB64)
  const iv = raw.slice(0, 12)
  const ct = raw.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new Uint8Array(pt)
}

/** 高熵救援碼（20 bytes = 160-bit）→ SHA-256 拉成 256-bit AES 金鑰
 *  （救援碼本身即高熵，不需慢速 PBKDF2；只需湊成合法的 AES 金鑰長度）。 */
const importRecoveryKey = async (recovery: Uint8Array): Promise<CryptoKey> => {
  const hashed = await crypto.subtle.digest('SHA-256', recovery)
  return crypto.subtle.importKey('raw', hashed, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// 救援碼字面：Crockford base32、每 4 碼一組（好抄寫、去掉易混字）
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const toBase32 = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}
const fromBase32 = (s: string): Uint8Array => {
  const clean = s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** 存進帳號的 E2EE 中繼資料——本身只是 DK 的兩份密文，無鑰即無用。可安全上雲。 */
export interface E2eeVault {
  v: 1
  passSalt: string // base64
  wrappedByPass: string // base64(iv‖ enc(DK) with 密語衍生金鑰)
  wrappedByRecovery: string // base64(iv‖ enc(DK) with 救援碼)
  check: string // base64：用 DK 加密的固定字串，用來快速驗證解出來的 DK 對不對
}

const CHECK_PLAINTEXT = te.encode('yike-e2ee-ok')

/** 開通 E2EE：產生主金鑰＋兩份包裝，並回傳「只出現這一次」的救援碼給使用者抄下。 */
export const setupE2ee = async (passphrase: string): Promise<{ vault: E2eeVault; recoveryKey: string; dk: CryptoKey }> => {
  const dkRaw = randomBytes(32)
  const dk = await crypto.subtle.importKey('raw', dkRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])

  const passSalt = randomBytes(16)
  const passKey = await deriveWrapKey(passphrase, passSalt)
  const wrappedByPass = await aesEncrypt(passKey, dkRaw)

  const recoveryRaw = randomBytes(20)
  const recKey = await importRecoveryKey(recoveryRaw)
  const wrappedByRecovery = await aesEncrypt(recKey, dkRaw)

  const check = await aesEncrypt(dk, CHECK_PLAINTEXT)

  return {
    vault: { v: 1, passSalt: toB64(passSalt), wrappedByPass, wrappedByRecovery, check },
    recoveryKey: toBase32(recoveryRaw),
    dk,
  }
}

const verifyDk = async (dk: CryptoKey, vault: E2eeVault): Promise<CryptoKey> => {
  const got = await aesDecrypt(dk, vault.check)
  if (td.decode(got) !== 'yike-e2ee-ok') throw new Error('E2EE 驗證失敗')
  return dk
}

/** 用密語解鎖：拿到能加解密內容的主金鑰。密語錯 → throw（'密語錯誤'）。 */
export const unlockWithPassphrase = async (vault: E2eeVault, passphrase: string): Promise<CryptoKey> => {
  const passKey = await deriveWrapKey(passphrase, fromB64(vault.passSalt))
  let dkRaw: Uint8Array
  try {
    dkRaw = await aesDecrypt(passKey, vault.wrappedByPass)
  } catch {
    throw new Error('密語錯誤')
  }
  const dk = await crypto.subtle.importKey('raw', dkRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  return verifyDk(dk, vault)
}

/** 用救援碼解鎖（忘記密語時）。 */
export const unlockWithRecovery = async (vault: E2eeVault, recoveryKey: string): Promise<CryptoKey> => {
  const recKey = await importRecoveryKey(fromBase32(recoveryKey))
  let dkRaw: Uint8Array
  try {
    dkRaw = await aesDecrypt(recKey, vault.wrappedByRecovery)
  } catch {
    throw new Error('救援碼錯誤')
  }
  const dk = await crypto.subtle.importKey('raw', dkRaw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  return verifyDk(dk, vault)
}

/** 改密語：用現有主金鑰重包一份（不必重新加密任何內容）。 */
export const rewrapPassphrase = async (dk: CryptoKey, vault: E2eeVault, newPassphrase: string): Promise<E2eeVault> => {
  const dkRaw = new Uint8Array(await crypto.subtle.exportKey('raw', dk))
  const passSalt = randomBytes(16)
  const passKey = await deriveWrapKey(newPassphrase, passSalt)
  return { ...vault, passSalt: toB64(passSalt), wrappedByPass: await aesEncrypt(passKey, dkRaw) }
}

/** 加密一筆同步內容（任意 JSON 值）。 */
export const encryptValue = async (dk: CryptoKey, value: unknown): Promise<string> =>
  aesEncrypt(dk, te.encode(JSON.stringify(value)))

/** 解密一筆同步內容。 */
export const decryptValue = async (dk: CryptoKey, blobB64: string): Promise<unknown> =>
  JSON.parse(td.decode(await aesDecrypt(dk, blobB64)))

// 匯出給測試/工具用（一般流程用不到）
export const _internal = { toBase32, fromBase32, aesEncrypt, aesDecrypt, deriveWrapKey, randomBytes }
