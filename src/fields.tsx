// IME-safe 受控輸入。
// 關鍵：組字（composition）期間用「本地暫存值」顯示，不讓父層的舊 value 在重繪時
// 把正在組的字洗掉（這會讓 iOS WKWebView 打不了中文）；組字結束才把最終值送上去。
// 桌機：組字中不通知父層 → 不會因重繪而重複字。兩邊都正確。
import { useLayoutEffect, useRef, useState } from 'react'

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (v: string) => void
}

export function TextField({ value, onValue, ...rest }: InputProps) {
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

export function TextArea({ value, onValue, ...rest }: AreaProps) {
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
