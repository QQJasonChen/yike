// public/ 靜態頁的 CSP 產生器。
//
// 為什麼要有這支：App 本體的 CSP 由 vite.config.ts 的 cspPlugin 注入，但 public/ 裡的
// landing / manual / privacy / security 是直接拷貝出去的靜態檔，**不經過那個 plugin**。
// 它們跟 App 同一個 origin——只要其中一頁載了一支第三方腳本，那支腳本就讀得到
// localStorage 裡的日記與 token。所以這幾頁也要有 CSP。
//
// 行內 <script> 用 sha256 hash 放行（不用 'unsafe-inline'）。代價：改了那段 script 一個
// 空白，hash 就對不上，頁面會靜默壞掉（動畫不跑、統計不送，沒有任何錯誤畫面）。
// 所以 meta 不手寫：這支從實際的 script 內容算 hash 並寫回去，`--check` 模式只比對，
// 對不上就 exit 1——放進 scripts/ship-gate.sh。
//
// 用法：node scripts/static-csp.mjs          # 寫回四個檔
//       node scripts/static-csp.mjs --check  # 只比對
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const PAGES = ['public/landing.html', 'public/manual.html', 'public/privacy.html', 'public/security.html', 'public/activate.html']
const MARK = 'data-static-csp' // 用這個屬性認出我們自己寫的那一個 meta

const build = (html, file) => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const external = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1])
  if (external.length)
    throw new Error(`${file} 載入了外部腳本 ${external.join(', ')}——同 origin 的第三方 JS 讀得到日記，不准`)
  const hashes = inline.map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`)
  const frames = [...html.matchAll(/<iframe[^>]*\bsrc="(https?:\/\/[^/"]+)/g)].map((m) => m[1])
  const forms = /<form\b/.test(html)
  return [
    "default-src 'self'",
    hashes.length ? `script-src ${hashes.join(' ')}` : "script-src 'none'",
    // 這幾頁有 style="" 屬性，沒有 'unsafe-inline' 會整個失效（跟 App 本體同一個理由）
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // 匿名統計是計數用的圖片請求（見 src/analytics.ts），不是腳本
    "img-src 'self' data: https://yike.goatcounter.com",
    "connect-src 'none'",
    frames.length ? `frame-src ${[...new Set(frames)].join(' ')}` : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    forms ? "form-action 'self'" : "form-action 'none'",
  ].join('; ')
}

const check = process.argv.includes('--check')
let bad = 0
for (const file of PAGES) {
  const html = readFileSync(file, 'utf8')
  const csp = build(html, file)
  const tag = `<meta http-equiv="Content-Security-Policy" ${MARK} content="${csp}">`
  const re = new RegExp(`<meta http-equiv="Content-Security-Policy" ${MARK} content="[^"]*">`)
  const has = re.test(html)
  const current = has ? html.match(re)[0] : null
  if (check) {
    if (current !== tag) {
      console.error(`✗ ${file}：CSP ${has ? '過期（行內 script 改過但 meta 沒重算）' : '缺少'}。跑 node scripts/static-csp.mjs`)
      bad++
    } else console.log(`✓ ${file}`)
    continue
  }
  const next = has
    ? html.replace(re, tag)
    : html.replace(/<meta charset="[^"]+"\s*\/?>/i, (m) => `${m}\n  ${tag}`)
  if (!next.includes(MARK)) throw new Error(`${file} 找不到 <meta charset> 可以插在後面`)
  if (next !== html) {
    writeFileSync(file, next)
    console.log(`寫入 ${file}`)
  } else console.log(`不變 ${file}`)
}
if (check && bad) process.exit(1)
