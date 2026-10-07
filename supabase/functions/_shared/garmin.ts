// Garmin Health API 共用：設定、PostgREST（service role）、token 換發與自動續期。
// garmin-oauth 與 garmin-webhook 共用。

const env = (k: string, d = '') => Deno.env.get(k) ?? d
export const SB_URL = env('SUPABASE_URL')
export const SRK = env('SUPABASE_SERVICE_ROLE_KEY')
export const CLIENT_ID = env('GARMIN_CLIENT_ID')
export const CLIENT_SECRET = env('GARMIN_CLIENT_SECRET')
export const AUTH_URL = env('GARMIN_AUTH_URL', 'https://connect.garmin.com/oauth2Confirm')
export const TOKEN_URL = env('GARMIN_TOKEN_URL', 'https://diauth.garmin.com/di-oauth2-service/oauth/token')
export const API = env('GARMIN_API_BASE', 'https://apis.garmin.com')

export const db = (path: string, init: RequestInit = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export const tokenRequest = async (params: Record<string, string>): Promise<TokenResponse> => {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || !body.access_token) throw new Error(`token ${r.status}`)
  return body as TokenResponse
}

export const expiresAt = (t: TokenResponse) =>
  new Date(Date.now() + Math.max(60, (t.expires_in ?? 86400) - 600) * 1000).toISOString()

export interface Link {
  user_id: string
  garmin_user_id: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
}

/** 取得有效 access token（過期就用 refresh token 換新並存回） */
export const validToken = async (link: Link): Promise<string> => {
  if (!link.expires_at || new Date(link.expires_at).getTime() > Date.now() || !link.refresh_token)
    return link.access_token
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: link.refresh_token })
  await db(`garmin_links?user_id=eq.${link.user_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? link.refresh_token,
      expires_at: expiresAt(t),
    }),
  })
  return t.access_token
}

export const getLink = async (uid: string): Promise<Link | null> => {
  const r = await db(`garmin_links?user_id=eq.${uid}&select=*`)
  const rows = (await r.json().catch(() => [])) as Link[]
  return rows[0] ?? null
}

