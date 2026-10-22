// 手機版版面探針：量真實幾何，不看圖。
//
// 為什麼要有這支：這兩類 bug 用眼睛看截圖抓不到，而且改 CSS 很容易再犯——
//   ① 命中區重疊：🔍 與 ⚙ 各自貼一個 44×44 的透明 ::after，但兩顆的中心距只有
//      25px，實測重疊 20px。瞄著 🔍 的右半邊按下去會開設定。
//   ② 疊層順序：手機版把 .timer-bar 抬到 62（要蓋過底部 tab-bar 的 60）之後，
//      原本 60 的 .settings-overlay 與 61 的 .tab-more 反而被計時器蓋住。
//
// 跑法：
//   npm run build && npx vite preview --port 4180 &
//   node scripts/ui-probe.mjs http://localhost:4180/
// 需要 playwright（本 repo 沒有列為依賴）：設 PLAYWRIGHT_PATH 指到 index.js，
// 或在有 playwright 的專案裡 `npm i -D playwright` 後執行。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const candidates = [
  process.env.PLAYWRIGHT_PATH,
  'playwright',
  `${process.env.HOME}/node_modules/playwright/index.js`,
].filter(Boolean)
let pw
for (const c of candidates) {
  try {
    pw = require(c)
    break
  } catch {
    /* 換下一個 */
  }
}
if (!pw) {
  console.error('找不到 playwright。設 PLAYWRIGHT_PATH，或在有 playwright 的環境跑。')
  process.exit(2)
}
const { chromium, devices } = pw

const url = process.argv[2] ?? 'http://localhost:4180/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })
// 先跳過新手導覽，不然量到的是那層浮層
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('pp:onboarded', '1')
  } catch {
    /* 私密模式 */
  }
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const probe = () => page.evaluate(() => {
  const fails = []

  // ── ① 命中區：44×44 且彼此不重疊 ───────────────────────────────
  // 量「真正吃到 tap 的那個盒」：如果按鈕有絕對定位、比自己還大的 ::after，
  // 那個才是命中盒。排版盒不可能互相重疊，偽元素可以——所以一定要這樣量。
  // 掃全部可點元素，不是只掃幾個 class——第一版只列了三個 selector，
  // 結果日檢視 53 個可點元素裡有 41 個不到 44px 完全沒被量到。
  // 有浮層開著（設定面板）就只量浮層裡的：底下的頁面元素還在 DOM 裡、
  // offsetParent 也不是 null，但它們被面板蓋住，量出來的重疊是假的。
  const scope = document.querySelector('.settings-overlay') ?? document
  const inOverlay = scope !== document
  const tapEls = [...scope.querySelectorAll('button, a[href], input[type=checkbox], [role=button]')]
    .filter((e) => e.offsetParent !== null && !e.disabled)
  const tapBoxes = tapEls
    .map((e) => {
      const r = e.getBoundingClientRect()
      const after = getComputedStyle(e, '::after')
      const w = parseFloat(after.width) || 0
      const h = parseFloat(after.height) || 0
      const id = (e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 10)
      // ::after 比排版盒大（任一維）→ 有效命中盒是兩者的聯集（都置中，所以取 max）
      if (after.content !== 'none' && after.position === 'absolute' && (w > r.width || h > r.height)) {
        const W = Math.max(w, r.width)
        const H = Math.max(h, r.height)
        return {
          id,
          el: e,
          left: r.left + r.width / 2 - W / 2,
          right: r.left + r.width / 2 + W / 2,
          top: r.top + r.height / 2 - H / 2,
          bottom: r.top + r.height / 2 + H / 2,
        }
      }
      return { id, el: e, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    })
    .filter((b) => b.right - b.left > 0 && b.bottom - b.top > 0)
  // 尺寸：44×44 是目標；密集列（心情/分數/少排多排/週勾）做不到就至少一維 ≥44、
  // 另一維 ≥ 中心距（不重疊）。這裡的門檻是「至少一維 44、另一維 ≥ 34」，
  // 低於它的一定是漏掉的。
  const small = []
  for (const b of tapBoxes) {
    // 段落裡的行內連結不受 44px 規則管（WCAG 2.5.8 的例外）：把它撐到 44 高會把整段文字撐開
    if (b.el.tagName === 'A' && getComputedStyle(b.el).display === 'inline') continue
    const w = b.right - b.left
    const h = b.bottom - b.top
    const W = Math.round(w), H = Math.round(h)
    // 一般：至少一維 44、另一維 ≥30。密集格（同 class 的鄰居中心距兩軸都 <44，例如種樹格）：
    // 44 根本放不下又不能重疊，接受 36×30（寬到中心距、高到列距）
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2
    // 擁擠：任何別的可點元素中心在 44px 內（例如種樹格右邊 40px 就是「−」）
    const dense = tapBoxes.some((o) => o !== b &&
      Math.abs((o.left + o.right) / 2 - cx) < 44 && Math.abs((o.top + o.bottom) / 2 - cy) < 44)
    const okSize = (Math.max(W, H) >= 44 && Math.min(W, H) >= 30) || (dense && W >= 36 && H >= 30)
    if (!okSize) small.push(`${b.id} ${W}×${H}`)
  }
  if (small.length) fails.push(`命中區太小（${small.length} 個）：${small.join('；')}`)
  for (let i = 0; i < tapBoxes.length; i++)
    for (let j = i + 1; j < tapBoxes.length; j++) {
      const a = tapBoxes[i]
      const b = tapBoxes[j]
      // 父子（例如月曆格子裡的 chip）本來就重疊，不算
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      // 固定的底部 tab-bar 蓋在內容最後一列上是正常的（它在上層、會贏）；
      // 真正要守的是「頁面底部 padding 夠不夠讓那一列捲出來」——見下面 ④。
      const bar = document.querySelector('.tab-bar')
      if (bar && (bar.contains(a.el) !== bar.contains(b.el))) continue
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 1 && oy > 1)
        fails.push(`命中區重疊：${a.id} × ${b.id}（${Math.round(ox)}×${Math.round(oy)}px）`)
    }

  // ── ② 疊層順序（媒體查詢覆寫後真正生效的值）─────────────────────
  const z = (cls) => {
    const d = document.createElement('div')
    d.className = cls
    document.body.appendChild(d)
    const v = getComputedStyle(d).zIndex
    d.remove()
    return v === 'auto' ? null : Number(v)
  }
  const L = {
    tabBar: z('tab-bar'),
    timerBar: z('timer-bar'),
    tabMoreBackdrop: z('tab-more-backdrop'),
    tabMore: z('tab-more'),
    settings: z('settings-overlay'),
    focusToast: z('focus-toast'),
    saveFailed: z('save-failed'),
  }
  const above = (a, b, why) => {
    if (L[a] === null || L[b] === null) return // 這個 class 在這一版不存在（例如 .save-failed），規則不適用
    if (!(L[a] > L[b])) fails.push(`疊層錯了：${a}(${L[a]}) 必須高於 ${b}(${L[b]})——${why}`)
  }
  above('timerBar', 'tabBar', '否則「暫停/完成/放棄」整排在 tab 底下按不到')
  above('tabMore', 'timerBar', '「更多」選單跟計時器的 bottom 幾乎相同，一定會重疊')
  above('tabMoreBackdrop', 'timerBar', '同上')
  above('settings', 'timerBar', '計時中打開設定，計時器會浮在面板上面')
  // ── ④ 固定 tab-bar 底下要留得出空間：最後一個可點元素必須能捲到 tab-bar 上方 ──
  const bar = document.querySelector('.tab-bar')
  if (bar && !inOverlay) { // 浮層有自己的捲動容器，這條只對頁面本體有意義
    const barTop = bar.getBoundingClientRect().top
    const de = document.documentElement
    const maxScroll = de.scrollHeight - de.clientHeight
    const content = tapBoxes.filter((b) => !bar.contains(b.el))
    const lowest = Math.max(...content.map((b) => b.bottom))
    // 捲到最底之後，最低的那顆在畫面上的位置
    const afterScroll = lowest - maxScroll
    if (afterScroll > barTop + 1)
      fails.push(`底部 padding 不夠：捲到底後最後一個可點元素的下緣 ${Math.round(afterScroll)}px，仍在 tab-bar（top ${Math.round(barTop)}px）底下`)
  }

  // ── ③ 橫向溢出（判準是量 scrollWidth，不是看圖有沒有被裁）──────────
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth)
    fails.push(`橫向溢出：scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`)

  return { fails, layers: L, tapBoxes: tapBoxes.length }
})

// 每個檢視都量。週勾、月曆、設定面板裡的控制項只在對應檢視才 mount。
const views = [
  ['日', null],
  ['週', '.tab-bar > button:nth-child(2)'],
  ['月', '.tab-bar > button:nth-child(3)'],
  ['更多', '.tab-bar > button:nth-child(5)'],
  ['設定', '.gear-btn[aria-label="設定"]'],
]
let allFails = 0
let layersShown = false
for (const [name, sel] of views) {
  if (sel) {
    try {
      await page.click(sel, { timeout: 5000 })
      await page.waitForTimeout(500)
    } catch {
      console.error(`[${name}] 切不過去（${sel}）——算失敗，不是跳過`)
      allFails += 1
      continue
    }
  }
  const result = await probe()
  if (!layersShown) {
    console.log(`疊層 ${JSON.stringify(result.layers)}`)
    layersShown = true
  }
  if (result.fails.length) {
    console.error(`[${name}] ${result.tapBoxes} 個命中區，✗ ${result.fails.length} 條不合格：`)
    for (const f of result.fails) console.error('  - ' + f)
    allFails += result.fails.length
  } else {
    console.log(`[${name}] ${result.tapBoxes} 個命中區 ✓`)
  }
  // 設定是浮層，關掉再量下一個
  if (name === '設定') await page.keyboard.press('Escape').catch(() => {})
}
// ── ⑤ 疊層要量真的：.tab-more 是 .tab-bar 的子孫，困在 tab-bar 的 stacking context 裡，
//    自己的數字再大也翻不過外面的計時器。注入一個假計時器，開「更多」，看重疊處誰接到點擊。
const moreSel = '.tab-bar > button:nth-child(5)'
if (await page.$(moreSel)) {
  // 先把設定面板關掉（上一個檢視開著它），再開選單，**然後**才注入假計時器——
  // 先注入的話它蓋在 tab-bar 上，連「更多」都按不到
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForSelector('.settings-overlay', { state: 'detached', timeout: 3000 }).catch(() => {})
  await page.click(moreSel)
  const menu = await page.waitForSelector('.tab-more', { timeout: 3000 }).catch(() => null)
  await page.evaluate(() => {
    const fake = document.createElement('div')
    fake.className = 'timer-bar'
    fake.setAttribute('data-probe-fake', '1')
    fake.style.cssText += ';height:60px;background:rgba(255,0,0,.3);pointer-events:auto;'
    document.body.appendChild(fake)
  })
  if (!menu) {
    console.error('按了「更多」但 .tab-more 沒出現')
    allFails += 1
  } else {
    const verdict = await page.evaluate(() => {
      const menu = document.querySelector('.tab-more')
      const fake = document.querySelector('[data-probe-fake]')
      if (!menu || !fake) return 'no-overlap'
      const m = menu.getBoundingClientRect(), f = fake.getBoundingClientRect()
      const ox = Math.min(m.right, f.right) - Math.max(m.left, f.left)
      const oy = Math.min(m.bottom, f.bottom) - Math.max(m.top, f.top)
      if (ox <= 2 || oy <= 2) return 'no-overlap'
      const hit = document.elementFromPoint(Math.max(m.left, f.left) + ox / 2, Math.max(m.top, f.top) + oy / 2)
      return menu.contains(hit) ? 'menu' : 'timer'
    })
    if (verdict === 'timer') {
      console.error('✗ 「更多」選單跟計時器重疊處，點到的是計時器——選單困在 tab-bar 的 stacking context 裡')
      allFails += 1
    } else console.log(`疊層實測：「更多」選單 vs 計時器 → ${verdict === 'menu' ? '選單在上 ✓' : '沒重疊'}`)
  }
  await page.evaluate(() => document.querySelector('[data-probe-fake]')?.remove())
}
await browser.close()
if (allFails) {
  console.error(`\n✗ 共 ${allFails} 條不合格`)
  process.exit(1)
}
console.log('✓ 命中區、疊層、底部 padding、橫向溢出全部合格')
