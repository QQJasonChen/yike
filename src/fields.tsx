// IME-safe 受控輸入：中文/日文等需要「組字」的輸入法，組字中不送出 onValue，
// 等 compositionend 才送，避免 controlled input 在組字中被重繪導致重複字。
import { useRef } from 'react'

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onValue: (v: string) => void
}

export function TextField({ value, onValue, ...rest }: InputProps) {
  const composing = useRef(false)
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => {
        if (!composing.current) onValue(e.currentTarget.value)
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        onValue(e.currentTarget.value)
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
  return (
    <textarea
      {...rest}
      value={value}
      onChange={(e) => {
        if (!composing.current) onValue(e.currentTarget.value)
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        onValue(e.currentTarget.value)
      }}
    />
  )
}
