// 手寫便箋 JS 橋接：對應原生 InkPlugin（iPad PencilKit）。
// 非 iPad / 非原生一律 no-op，桌機/手機零影響。
import { Capacitor, registerPlugin } from '@capacitor/core'

interface InkNative {
  available(): Promise<{ available: boolean }>
  edit(opts: { drawing?: string }): Promise<{ png?: string; drawing?: string; cancelled?: boolean }>
}

const native = registerPlugin<InkNative>('Ink')

let cached: boolean | null = null

export const ink = {
  /** 只有 iPad 原生 app 有手寫；其他一律 false */
  async available(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return false
    if (cached !== null) return cached
    try {
      cached = (await native.available()).available
    } catch {
      cached = false
    }
    return cached
  },

  /** 開啟原生手寫編輯器（可帶入既有筆跡再編輯）。回傳 {png, drawing}，取消回 null */
  async edit(drawing?: string): Promise<{ png: string; drawing: string } | null> {
    if (!Capacitor.isNativePlatform()) return null
    try {
      const r = await native.edit({ drawing: drawing ?? '' })
      if (r.cancelled) return null
      return { png: r.png ?? '', drawing: r.drawing ?? '' }
    } catch {
      return null
    }
  },
}
