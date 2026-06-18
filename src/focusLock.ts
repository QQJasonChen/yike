// 專注鎖 JS 橋接：對應原生 FocusLockPlugin（iOS Screen Time）。
// 非原生（桌機/PWA）一律 no-op，呼叫端不必另外判斷平台。
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface FocusLockState {
  supported: boolean
  authorized: boolean
  hasSelection: boolean
  locked: boolean
}

interface FocusLockNative {
  isSupported(): Promise<{ supported: boolean }>
  getState(): Promise<FocusLockState>
  requestAuthorization(): Promise<{ authorized: boolean; error?: string }>
  pickApps(): Promise<{ count: number; cancelled: boolean }>
  startLock(): Promise<{ locked: boolean; reason?: string }>
  stopLock(): Promise<{ locked: boolean }>
}

const native = registerPlugin<FocusLockNative>('FocusLock')

const OFF: FocusLockState = { supported: false, authorized: false, hasSelection: false, locked: false }

// Family Controls 散布權限（Distribution）核准前，App-lock 在 TestFlight/正式版一律關閉，
// 避免出現按了沒反應的死開關。核准 + 把 entitlement 接回 pbxproj 後，改成 true 即整套復活。
export const APPLOCK_ENABLED = false

/** 只有原生 iOS 且功能已啟用才有專注鎖；桌機/Android/PWA/未啟用一律回 false */
export const focusLockAvailable = (): boolean =>
  APPLOCK_ENABLED && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export const focusLock = {
  available: focusLockAvailable,

  async getState(): Promise<FocusLockState> {
    if (!focusLockAvailable()) return OFF
    try {
      return await native.getState()
    } catch {
      return OFF
    }
  },

  /** 跳系統授權，回傳是否已授權 */
  async requestAuthorization(): Promise<boolean> {
    if (!focusLockAvailable()) return false
    try {
      return (await native.requestAuthorization()).authorized
    } catch {
      return false
    }
  },

  /** 開系統 App 選擇器，回傳選了幾個 */
  async pickApps(): Promise<number> {
    if (!focusLockAvailable()) return 0
    try {
      return (await native.pickApps()).count
    } catch {
      return 0
    }
  },

  /** 上盾（專注開始） */
  async start(): Promise<void> {
    if (!focusLockAvailable()) return
    try {
      await native.startLock()
    } catch {
      /* 略：鎖失敗不該擋住計時 */
    }
  },

  /** 解盾（專注結束 / 休息 / 結束 / 安全網） */
  async stop(): Promise<void> {
    if (!focusLockAvailable()) return
    try {
      await native.stopLock()
    } catch {
      /* 略 */
    }
  },
}
