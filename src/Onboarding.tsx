// 首次開啟的歡迎引導（只出現一次）。教方法、降低空白頁焦慮。
interface Props {
  onClose: () => void
}

const STEPS = [
  { icon: '⭐', title: '今天最重要的一件事', body: '每天先定一個最重要任務（MIT）——最不舒服、最容易拖的那件。' },
  { icon: '▶', title: '按下番茄鐘，專注', body: '對任務按 ▶ 開始計時，一段 25 分鐘。專注幾段、塗幾個圈。' },
  { icon: '🌙', title: '晚上回顧一句話', body: '記下今天的亮點、學到什麼。日→週→月→季→年，慢慢長成你的第二大腦。' },
]

export default function Onboarding({ onClose }: Props) {
  return (
    <div className="ob-overlay" onClick={onClose}>
      <div className="ob-card" onClick={(e) => e.stopPropagation()}>
        <div className="ob-brand">一刻手帳 Yike</div>
        <h2 className="ob-title">歡迎。先從今天的一刻開始。</h2>
        <p className="ob-sub">一個紙感的每日專注手帳。不用註冊、資料在你手上。</p>

        <div className="ob-steps">
          {STEPS.map((s) => (
            <div key={s.title} className="ob-step">
              <span className="ob-step-icon">{s.icon}</span>
              <div>
                <div className="ob-step-title">{s.title}</div>
                <div className="ob-step-body">{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        <button className="ob-cta" onClick={onClose}>
          開始寫今天 →
        </button>
        <p className="ob-foot">隨時可在右上角 ⚙ 設定裡自訂問題、習慣與雲端同步。</p>
      </div>
    </div>
  )
}
