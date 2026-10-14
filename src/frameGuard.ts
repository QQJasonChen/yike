// Client-side iframe mitigation, not an HTTP frame-ancestors/X-Frame-Options policy.
export const isFramed = (w: { top?: unknown; self?: unknown } = window): boolean => {
  try { return w.top !== w.self } catch { return true }
}

/** Stop startup; never attempt automatic top-window navigation. */
export const guardFraming = (w: { top?: unknown; self?: unknown } = window): boolean => isFramed(w)

export const renderFrameWarning = (root: HTMLElement): void => {
  root.replaceChildren()
  const box = document.createElement('div')
  box.className = 'page-inner'
  const heading = document.createElement('p')
  heading.textContent = '一刻手帳未在嵌入頁面中啟動。'
  const text = document.createElement('p')
  text.textContent = '為避免在其他網站的框架內誤操作，請另開一刻手帳網站。'
  const link = document.createElement('a')
  link.href = 'https://yikeday.com/'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'https://yikeday.com/'
  box.append(heading, text, link)
  root.append(box)
}
