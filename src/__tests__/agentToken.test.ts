// 給 AI 助理的 token：格式、雜湊、與資料庫的互動形狀。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn() }
let inserted: Record<string, unknown> | null = null
let updated: { patch: Record<string, unknown>; id: string } | null = null
let listed: unknown[] = []
const from = vi.fn(() => ({
  insert: (rowIn: Record<string, unknown>) => {
    inserted = rowIn
    return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }) }) }
  },
  update: (patch: Record<string, unknown>) => ({
    eq: (_c: string, id: string) => {
      updated = { patch, id }
      return Promise.resolve({ error: null })
    },
  }),
  select: () => ({
    is: () => ({ order: () => Promise.resolve({ data: listed, error: null }) }),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import {
  TOKEN_PREFIX,
  createAgentToken,
  generateAgentToken,
  hashAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from '../agentToken'

const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'

beforeEach(() => {
  inserted = null
  updated = null
  listed = []
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: BOB } } } })
})

describe('token 本身', () => {
  it('yk_ 開頭、43 字元 base64url、每次不同', () => {
    const a = generateAgentToken()
    const b = generateAgentToken()
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(a).toMatch(/^yk_[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it('hash 穩定、64 hex、不同 token 不同 hash', async () => {
    const t = generateAgentToken()
    const h1 = await hashAgentToken(t)
    expect(h1).toBe(await hashAgentToken(t))
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(await hashAgentToken(generateAgentToken()))
  })
})

describe('createAgentToken', () => {
  it('存的是 hash 不是明文；scope 寫死 read；回明文', async () => {
    const { token: plain, id } = await createAgentToken('  Grok  ')
    expect(plain).toMatch(/^yk_/)
    expect(id).toBe('new-id') // 畫面要靠它判斷「撤銷的是不是剛產生這組」
    expect(inserted).not.toBeNull()
    expect(inserted!.token_hash).toBe(await hashAgentToken(plain))
    expect(JSON.stringify(inserted)).not.toContain(plain) // 明文絕不落庫
    expect(inserted!.scope).toBe('read')
    expect(inserted!.user_id).toBe(BOB)
    expect(inserted!.label).toBe('Grok')
  })

  it('沒登入 → 丟錯，不會寫任何東西', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(createAgentToken('x')).rejects.toThrow('請先登入')
    expect(inserted).toBeNull()
  })
})

describe('revoke / list', () => {
  it('撤銷＝填 revoked_at（不刪列）', async () => {
    await revokeAgentToken('tok-1')
    expect(updated!.id).toBe('tok-1')
    expect(typeof updated!.patch.revoked_at).toBe('string')
  })

  it('清單只拿 metadata，沒有 hash 欄位', async () => {
    listed = [{ id: '1', label: 'Grok', scope: 'read', created_at: 'x', last_used_at: null }]
    const r = await listAgentTokens()
    expect(r).toHaveLength(1)
    expect(JSON.stringify(r)).not.toContain('token_hash')
  })
})
