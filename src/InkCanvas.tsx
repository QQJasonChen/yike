// 跨平台 web 手寫畫布（手機/桌機/iPad-Safari）。Pointer 事件 + 壓力感應 + 單指防誤觸。
// 存：PNG（顯示）＋ 筆畫 JSON（可再編輯）。原生 iPad 走 PencilKit，不走這個。
import { useEffect, useRef, useState } from 'react'

type Pt = [number, number, number] // x, y, pressure
interface Stroke {
  color: string
  size: number
  pts: Pt[]
}
interface Props {
  initial?: string // 筆畫 JSON（fmt=web）
  onSave: (png: string, drawing: string) => void
  onCancel: () => void
}

const COLORS = ['#2b2620', '#db6e1c', '#3d5a73', '#6f8f6a', '#b65c38']

export default function InkCanvas({ initial, onSave, onCancel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const active = useRef<{ id: number; stroke: Stroke } | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const colorRef = useRef(color)
  colorRef.current = color

  useEffect(() => {
    const c = ref.current!
    const rect = c.getBoundingClientRect()
    // 解析度上限 2x：3x 手機存出的 PNG 會大一倍以上，但肉眼幾乎看不出差別。
    // 手寫是本機空間（約 5MB）的最大宗，2026-11-10 有用戶因空間塞滿而無法登入。
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(rect.width * dpr)
    c.height = Math.round(rect.height * dpr)
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    if (initial) {
      try {
        strokes.current = JSON.parse(initial)
      } catch {
        strokes.current = []
      }
    }
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ctx = () => ref.current!.getContext('2d')!
  const seg = (g: CanvasRenderingContext2D, s: Stroke, a: Pt, b: Pt) => {
    g.strokeStyle = s.color
    g.lineWidth = s.size * (0.35 + ((a[2] + b[2]) / 2) * 1.3)
    g.beginPath()
    g.moveTo(a[0], a[1])
    g.lineTo(b[0], b[1])
    g.stroke()
  }
  const redraw = () => {
    const c = ref.current!
    const g = ctx()
    g.clearRect(0, 0, c.width, c.height)
    for (const s of strokes.current) for (let i = 1; i < s.pts.length; i++) seg(g, s, s.pts[i - 1], s.pts[i])
  }
  const pos = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    // 座標取到 0.1px、壓力取到 0.01：筆畫 JSON 少一半左右，畫出來看不出差別。
    const round = (v: number, d: number) => Math.round(v * d) / d
    return [round(e.clientX - r.left, 10), round(e.clientY - r.top, 10), round(e.pressure > 0 ? e.pressure : 0.5, 100)]
  }

  const down = (e: React.PointerEvent) => {
    if (active.current) return // 一次只認一支筆（防手掌誤觸）
    e.preventDefault()
    ref.current!.setPointerCapture(e.pointerId)
    const stroke: Stroke = { color: colorRef.current, size: 2.8, pts: [pos(e)] }
    strokes.current.push(stroke)
    active.current = { id: e.pointerId, stroke }
  }
  const move = (e: React.PointerEvent) => {
    if (!active.current || e.pointerId !== active.current.id) return
    const p = pos(e)
    const s = active.current.stroke
    s.pts.push(p)
    if (s.pts.length >= 2) seg(ctx(), s, s.pts[s.pts.length - 2], p)
  }
  const up = (e: React.PointerEvent) => {
    if (active.current?.id === e.pointerId) active.current = null
  }

  const clear = () => {
    strokes.current = []
    redraw()
  }
  const save = () => {
    const c = ref.current!
    const has = strokes.current.some((s) => s.pts.length > 0)
    onSave(has ? c.toDataURL('image/png').split(',')[1] : '', has ? JSON.stringify(strokes.current) : '')
  }

  return (
    <div className="inkc-overlay">
      <div className="inkc-bar">
        <button className="inkc-btn" onClick={onCancel}>
          取消
        </button>
        <span className="inkc-colors">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`inkc-color ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </span>
        <button className="inkc-btn" onClick={clear}>
          清除
        </button>
        <button className="inkc-btn done" onClick={save}>
          完成
        </button>
      </div>
      <canvas
        ref={ref}
        className="inkc-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    </div>
  )
}
