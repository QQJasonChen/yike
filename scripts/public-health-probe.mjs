// Public reachability/RLS metadata probe only; no purchase or notification guarantee.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const PROJECT = 'ofhupqifavtafiylehkj'
const BASE = `https://${PROJECT}.supabase.co`
const validAnon = value => {
  try {
    if (typeof value !== 'string' || value.length > 8192 || value.split('.').length !== 3) return false
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'))
    return payload.role === 'anon' && payload.ref === PROJECT
  } catch { return false }
}
export function readPublicAnonConfig(source) {
  const urls = source.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) ?? []
  const keys = source.match(/eyJ[A-Za-z0-9_.-]+/g) ?? []
  if (urls.length !== 1 || urls[0] !== BASE || keys.length !== 1 || !validAnon(keys[0]))
    throw new Error('public configuration invalid')
  return keys[0]
}
const summarize = checks => ({ ok: checks.every(check => check.ok), passed: checks.filter(check => check.ok).length, total: checks.length, checks })
const release = response => { try { void response?.body?.cancel().catch(() => {}) } catch { /* Never read any body. */ } }

export async function runPublicHealthProbe({ anonKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (!validAnon(anonKey) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    return summarize([{ name: 'configuration', ok: false, status: null, reason: 'config' }])
  const definitions = [
    { name: 'anonymous-journal', path: '/rest/v1/journal?select=user_id', method: 'HEAD', statuses: [200] },
    { name: 'auth', path: '/auth/v1/health', method: 'GET', statuses: [200] },
    { name: 'activate', path: '/functions/v1/activate', method: 'OPTIONS', statuses: [200, 204, 405] },
    { name: 'gumroad', path: '/functions/v1/gumroad-ping', method: 'OPTIONS', statuses: [200, 204, 405] },
  ]
  return summarize(await Promise.all(definitions.map(async definition => {
    const controller = new AbortController()
    let response, timer, expired = false
    const result = (ok, reason) => ({ name: definition.name, ok, status: response?.status ?? null, ...(reason ? { reason } : {}) })
    try {
      const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
      if (definition.name === 'anonymous-journal') Object.assign(headers, { Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' })
      if (definition.method === 'OPTIONS') Object.assign(headers, { Origin: 'https://yikeday.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' })
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); reject(new Error('deadline')) }, timeoutMs) })
      response = await Promise.race([fetchImpl(`${BASE}${definition.path}`, { method: definition.method, headers, redirect: 'error', signal: controller.signal }), deadline])
      if (!definition.statuses.includes(response.status)) return result(false, 'status')
      if (definition.name === 'anonymous-journal') {
        const range = response.headers.get('content-range')?.trim()
        const unit = response.headers.get('range-unit')?.trim().toLowerCase()
        const exact = response.headers.get('preference-applied')?.split(',').some(value => value.trim().toLowerCase() === 'count=exact')
        if (!range || (unit !== undefined && unit !== 'items') || !exact || !/^(?:\*|\d+-\d+)\/\d+$/.test(range)) return result(false, 'headers')
        if (range.split('/')[1] !== '0') return result(false, 'nonzero-count')
        if (range !== '*/0') return result(false, 'headers')
      }
      return result(true)
    } catch { return result(false, expired ? 'timeout' : 'network') }
    finally { clearTimeout(timer); release(response); controller.abort() }
  })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result
  try {
    const source = await readFile(new URL('../src/cloudConfig.ts', import.meta.url), 'utf8')
    result = await runPublicHealthProbe({ anonKey: readPublicAnonConfig(source) })
  } catch { result = summarize([{ name: 'configuration', ok: false, status: null, reason: 'config' }]) }
  console.log(JSON.stringify(result)) // Aggregate/status only; never URLs, keys or upstream errors.
  process.exitCode = result.ok ? 0 : 1
}
