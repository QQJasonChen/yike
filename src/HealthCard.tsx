// 今天頁的「身體狀況」卡片：當天的 Garmin／Apple 健康指標 + 今日狀態建議 + 近 7 天小趨勢。
// 沒有任何健康資料的使用者完全看不到這張卡（入口在 ⚙ 設定 →「Garmin／健康數據」）。
import { useEffect, useState } from 'react'
import {
  HealthDay,
  HealthMetrics,
  SOURCE_LABEL,
  fmtDur,
  fmtInt,
  readiness,
} from './health'
import { HEALTH_EVENT } from './healthSync'
import { addDays, allHealthKeys, loadHealth } from './storage'

interface Tile {
  icon: string
  label: string
  value: string
  sub?: string
}

const tilesOf = (m: HealthMetrics): Tile[] => {
  const t: Tile[] = []
  if (m.sleepSec !== undefined) {
    const parts: string[] = []
    if (m.sleepScore !== undefined) parts.push(`分數 ${Math.round(m.sleepScore)}`)
    if (m.bedtime && m.wakeTime) parts.push(`${m.bedtime}→${m.wakeTime}`)
    if (m.deepSec !== undefined) parts.push(`深睡 ${fmtDur(m.deepSec)}`)
    t.push({ icon: '🌙', label: '睡眠', value: fmtDur(m.sleepSec), sub: parts.join('・') })
  }
  if (m.bodyBatteryHigh !== undefined || m.bodyBatteryLow !== undefined)
    t.push({
      icon: '🔋',
      label: '身體能量',
      value: m.bodyBatteryHigh !== undefined ? String(Math.round(m.bodyBatteryHigh)) : '—',
      sub: m.bodyBatteryLow !== undefined ? `最低 ${Math.round(m.bodyBatteryLow)}` : undefined,
    })
  if (m.trainingReadiness !== undefined)
    t.push({ icon: '🎯', label: '訓練準備度', value: String(Math.round(m.trainingReadiness)) })
  if (m.restingHr !== undefined)
    t.push({
      icon: '❤️',
      label: '靜止心率',
      value: `${Math.round(m.restingHr)}`,
      sub: m.maxHr !== undefined ? `bpm・最高 ${Math.round(m.maxHr)}` : 'bpm',
    })
  if (m.hrv !== undefined) t.push({ icon: '〰️', label: '夜間 HRV', value: `${Math.round(m.hrv)}`, sub: 'ms' })
  if (m.stressAvg !== undefined)
    t.push({
      icon: '🌡️',
      label: '平均壓力',
      value: `${Math.round(m.stressAvg)}`,
      sub: m.stressAvg <= 25 ? '放鬆' : m.stressAvg <= 50 ? '輕度' : m.stressAvg <= 75 ? '中度' : '高度',
    })
  if (m.steps !== undefined)
    t.push({
      icon: '👟',
      label: '步數',
      value: fmtInt(m.steps),
      sub: m.distanceM !== undefined ? `${(m.distanceM / 1000).toFixed(1)} km` : undefined,
    })
  if (m.intensityMin !== undefined) t.push({ icon: '🔥', label: '熱血時間', value: `${m.intensityMin}`, sub: '分鐘' })
  if (m.activeKcal !== undefined || m.totalKcal !== undefined)
    t.push({
      icon: '⚡',
      label: '卡路里',
      value: fmtInt(m.totalKcal ?? m.activeKcal!),
      sub: m.totalKcal !== undefined && m.activeKcal !== undefined ? `活動 ${fmtInt(m.activeKcal)}` : 'kcal',
    })
  if (m.floors !== undefined) t.push({ icon: '🪜', label: '爬樓', value: `${Math.round(m.floors)}`, sub: '層' })
  if (m.spo2Avg !== undefined) t.push({ icon: '🫁', label: '血氧', value: `${Math.round(m.spo2Avg)}%` })
  if (m.respirationAvg !== undefined)
    t.push({ icon: '🌬️', label: '呼吸', value: m.respirationAvg.toFixed(1), sub: '次/分' })
  if (m.weightKg !== undefined) t.push({ icon: '⚖️', label: '體重', value: m.weightKg.toFixed(1), sub: 'kg' })
  if (m.vo2max !== undefined) t.push({ icon: '🏃', label: 'VO₂ max', value: `${Math.round(m.vo2max)}` })
  return t
}

const FOLDED = 6

// 近 7 天小長條（單一色相；當天深色、其他淺色；hover 看數值）
const TRENDS: { key: keyof HealthMetrics; label: string; fmt: (v: number) => string }[] = [
  { key: 'sleepSec', label: '睡眠', fmt: fmtDur },
  { key: 'bodyBatteryHigh', label: '身體能量', fmt: (v) => String(Math.round(v)) },
  { key: 'steps', label: '步數', fmt: fmtInt },
]

function Spark({
  days,
  values,
  fmt,
  label,
}: {
  days: string[]
  values: (number | undefined)[]
  fmt: (v: number) => string
  label: string
}) {
  const max = Math.max(...values.map((v) => v ?? 0), 1)
  const W = 7 * 12
  const H = 26
  return (
    <svg className="hc-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 7 天${label}`}>
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} className="hc-base" />
      {values.map((v, i) => {
        const h = v === undefined ? 0 : Math.max(2, (v / max) * (H - 2))
        const md = days[i].slice(5).replace('-', '/')
        return (
          <g key={days[i]}>
            <rect x={i * 12} y={0} width={12} height={H} fill="transparent">
              <title>{`${md} ${label}：${v === undefined ? '無資料' : fmt(v)}`}</title>
            </rect>
            {v !== undefined && (
              <rect
                x={i * 12 + 2}
                y={H - h}
                width={8}
                height={h}
                rx={2}
                className={i === values.length - 1 ? 'hc-bar today' : 'hc-bar'}
                pointerEvents="none"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default function HealthCard({ dateKey }: { dateKey: string }) {
  const [rev, setRev] = useState(0)
  // 手機上預設只秀前 6 格（睡眠、身體能量、心率、HRV…），免得把手帳本體推太下面
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches
  const [expanded, setExpanded] = useState(() => {
    try {
      return !narrow || localStorage.getItem('ppl:healthExpanded') === '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    const on = () => setRev((n) => n + 1)
    window.addEventListener(HEALTH_EVENT, on)
    window.addEventListener('storage', on) // 其他分頁匯入
    return () => {
      window.removeEventListener(HEALTH_EVENT, on)
      window.removeEventListener('storage', on)
    }
  }, [])

  void rev
  const day: HealthDay | null = loadHealth(dateKey)
  if (!day) {
    // 有接過健康資料、但這天剛好沒有 → 一行提示；從沒接過 → 整張卡不出現
    if (allHealthKeys().length === 0) return null
    return <div className="health-card hc-empty">⌚ 這天沒有身體狀況資料（手錶同步後會自動出現）</div>
  }
  const week = Array.from({ length: 7 }, (_, i) => addDays(dateKey, i - 6))
  const weekData = week.map((k) => loadHealth(k)?.m)
  const history = weekData.slice(0, 6).filter((m): m is HealthMetrics => Boolean(m))
  const r = readiness(day.m, history)
  const tiles = tilesOf(day.m)
  const icon = r ? ({ high: '☀️', mid: '⛅', low: '🌧️' } as const)[r.level] : ''

  return (
    <section className="health-card" aria-label="身體狀況">
      <div className="hc-head">
        <span className="hc-title">⌚ 身體狀況</span>
        <span className="hc-src">{day.src.map((s) => SOURCE_LABEL[s]).join('＋')}</span>
      </div>
      {r && (
        <div className={`hc-ready ${r.level}`}>
          <span className="hc-ready-badge">
            {icon} {r.label} <b>{r.score}</b>
          </span>
          <span className="hc-advice">{r.advice}</span>
          {r.reasons.length > 0 && <span className="hc-reasons">{r.reasons.join('・')}</span>}
        </div>
      )}
      <div className="hc-tiles">
        {(expanded ? tiles : tiles.slice(0, FOLDED)).map((t) => (
          <div className="hc-tile" key={t.label}>
            <div className="hc-label">
              {t.icon} {t.label}
            </div>
            <div className="hc-value">{t.value}</div>
            {t.sub && <div className="hc-sub">{t.sub}</div>}
          </div>
        ))}
      </div>
      {tiles.length > FOLDED && narrow && (
        <button
          className="hc-more"
          onClick={() => {
            const v = !expanded
            setExpanded(v)
            try {
              localStorage.setItem('ppl:healthExpanded', v ? '1' : '0')
            } catch {
              /* 無痕模式：只影響這次 */
            }
          }}
        >
          {expanded ? '收起' : `＋ 其他 ${tiles.length - FOLDED} 項`}
        </button>
      )}
      {weekData.filter(Boolean).length >= 2 && (
        <div className="hc-trends">
          {TRENDS.filter((tr) => weekData.some((m) => m?.[tr.key] !== undefined)).map((tr) => (
            <div className="hc-trend" key={tr.key}>
              <span className="hc-trend-label">近 7 天{tr.label}</span>
              <Spark
                days={week}
                values={weekData.map((m) => m?.[tr.key] as number | undefined)}
                fmt={tr.fmt}
                label={tr.label}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
