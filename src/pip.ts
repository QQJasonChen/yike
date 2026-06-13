// 置頂浮窗（Document Picture-in-Picture）：專注時浮在所有分頁/App 之上的小倒數
// App 負責提供「目前計時狀態」來源；FocusTimer 與 startFocus 共用同一個視窗
import { TimerState } from './FocusTimer'

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

let pipWin: Window | null = null
let getTimer: () => TimerState | null = () => null
let closingByUs = false

const AUTO_KEY = 'pp:pipAuto' // 預設自動開；使用者手動關掉就記住別再跳

export const pipSupported = (): boolean =>
  typeof window !== 'undefined' && 'documentPictureInPicture' in window

export const pipAutoEnabled = (): boolean => localStorage.getItem(AUTO_KEY) !== '0'
export const setPipAuto = (on: boolean) => localStorage.setItem(AUTO_KEY, on ? '1' : '0')

/** App 註冊「目前計時狀態」的即時來源 */
export const setPipTimerSource = (fn: () => TimerState | null) => {
  getTimer = fn
}

export const isFloatingOpen = (): boolean => !!pipWin

/** 程式自己關（計時結束/卸載）——不更動使用者的自動偏好 */
export const closeFloating = () => {
  if (!pipWin) return
  closingByUs = true
  pipWin.close()
  pipWin = null
}

export async function openFloating(): Promise<void> {
  const dpip = window.documentPictureInPicture
  if (!dpip) return
  if (pipWin) {
    try {
      pipWin.focus()
    } catch {
      /* 略 */
    }
    return
  }
  let w: Window
  try {
    w = await dpip.requestWindow({ width: 248, height: 148 })
  } catch {
    return // 沒有使用者手勢或被取消
  }
  pipWin = w
  const doc = w.document
  doc.body.style.cssText =
    'margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:-apple-system,system-ui,"Noto Serif TC",serif;background:#1e2a40;color:#f5f0e6;user-select:none'
  const box = doc.createElement('div')
  box.style.cssText = 'text-align:center;padding:12px'
  const phase = doc.createElement('div')
  phase.style.cssText =
    'font-size:11px;letter-spacing:.28em;text-transform:uppercase;opacity:.65;margin-bottom:6px'
  const clock = doc.createElement('div')
  clock.style.cssText = 'font-size:50px;font-weight:300;font-variant-numeric:tabular-nums;line-height:1'
  const task = doc.createElement('div')
  task.style.cssText =
    'font-size:13px;opacity:.85;margin-top:8px;max-width:216px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  box.append(phase, clock, task)
  doc.body.append(box)

  const render = () => {
    const t = getTimer()
    if (!t) return
    const rem = t.pausedRemaining !== null ? t.pausedRemaining : t.endsAt - Date.now()
    const isBreak = t.phase === 'break'
    clock.textContent = fmtClock(rem)
    phase.textContent = isBreak ? '休息' : t.pausedRemaining !== null ? '已暫停' : '專注中'
    task.textContent = isBreak ? '起來走走、喝口水' : t.taskText || '未命名任務'
    doc.body.style.background = isBreak ? '#3a4a32' : '#1e2a40'
  }
  render()
  const iv = w.setInterval(render, 250)
  w.addEventListener('pagehide', () => {
    w.clearInterval(iv)
    pipWin = null
    if (!closingByUs) setPipAuto(false) // 手動關 = 記住，下次不自動跳
    closingByUs = false
  })
}
