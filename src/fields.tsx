// IME-safe 受控輸入。
// 關鍵：組字（composition）期間用「本地暫存值」顯示，不讓父層的舊 value 在重繪時
// 把正在組的字洗掉（這會讓 iOS WKWebView 打不了中文）；組字結束才把最終值送上去。
// 桌機：組字中不通知父層 → 不會因重繪而重複字。兩邊都正確。
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { recentNames } from './storage'

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (v: string) => void
}

export function TextField({ value, onValue, onKeyDown, ...rest }: InputProps) {
  const composing = useRef(false)
  const [buf, setBuf] = useState<string | null>(null)
  return (
    <input
      {...rest}
      value={buf !== null ? buf : value}
      onChange={(e) => {
        const v = e.currentTarget.value
        if (composing.current) setBuf(v)
        else {
          setBuf(null)
          onValue(v)
        }
      }}
      onKeyDown={(e) => {
        // 組字（IME 選字）期間按 Enter 等鍵不要觸發父層動作（跳下一欄/送出/關閉）
        if (composing.current || e.nativeEvent.isComposing) return
        onKeyDown?.(e)
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        const v = e.currentTarget.value
        setBuf(null)
        onValue(v)
      }}
    />
  )
}

type AreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (v: string) => void
}

export function TextArea({ value, onValue, onKeyDown, ...rest }: AreaProps) {
  const composing = useRef(false)
  const [buf, setBuf] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = buf !== null ? buf : value

  // 自動長高：跟著內容撐開，不出現內部捲軸（內容多時才好看）
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(fit, [shown])

  return (
    <textarea
      {...rest}
      ref={ref}
      value={shown}
      onChange={(e) => {
        const v = e.currentTarget.value
        if (composing.current) setBuf(v)
        else {
          setBuf(null)
          onValue(v)
        }
        fit()
      }}
      onKeyDown={(e) => {
        if (composing.current || e.nativeEvent.isComposing) return
        onKeyDown?.(e)
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        const v = e.currentTarget.value
        setBuf(null)
        onValue(v)
        fit()
      }}
    />
  )
}

// 命名輸入：TextField + 乾淨可控的「最近用過」自製下拉，取代原生 <datalist>（醜、難控、會蓋畫面）。
// 聚焦才開、邊打邊篩、最多 6 筆、點即填；用 onMouseDown preventDefault 避免 blur 搶先關掉。
export function NameField({ value, onValue, ...rest }: InputProps) {
  const [open, setOpen] = useState(false)
  const names = useMemo(() => (open ? recentNames() : []), [open])
  const q = value.trim().toLowerCase()
  const matches = open
    ? names.filter((n) => n && n !== value && (!q || n.toLowerCase().includes(q))).slice(0, 6)
    : []
  return (
    <span className="name-field">
      <TextField
        {...rest}
        value={value}
        onValue={onValue}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {matches.length > 0 && (
        <span className="name-menu">
          {matches.map((n) => (
            <button
              key={n}
              type="button"
              className="name-opt"
              onMouseDown={(e) => {
                e.preventDefault()
                onValue(n)
                setOpen(false)
              }}
            >
              {n}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
