import { beforeEach, describe, expect, it } from 'vitest'
import { buildIcs, icsDateTime, icsEscape, rangeToIcs } from '../icsExport'

describe('ics 匯出', () => {
  beforeEach(() => localStorage.clear())

  it('icsEscape 跳脫逗號/分號/換行/反斜線', () => {
    expect(icsEscape('a,b;c\nd\\e')).toBe('a\\,b\\;c\\nd\\\\e')
  })

  it('icsDateTime 組本地時間', () => {
    expect(icsDateTime('2026-07-06', 9 * 60 + 30)).toBe('20260706T093000')
    expect(icsDateTime('2026-12-31', 0)).toBe('20261231T000000')
  })

  it('buildIcs 結構正確（VCALENDAR/VEVENT/UID 穩定）', () => {
    const ics = buildIcs([
      { dateKey: '2026-07-06', start: 540, end: 660, text: '深度工作', note: '寫講稿', uidSeed: '2026-07-06-b1' },
    ])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('UID:2026-07-06-b1@yikeday.com')
    expect(ics).toContain('DTSTART:20260706T090000')
    expect(ics).toContain('DTEND:20260706T110000')
    expect(ics).toContain('SUMMARY:深度工作')
    expect(ics).toContain('DESCRIPTION:寫講稿')
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('rangeToIcs 撈範圍內全部時間塊；空範圍回 null', () => {
    localStorage.setItem(
      'pp:day:2026-07-06',
      JSON.stringify({
        tasks: [],
        blocks: [
          { id: 'a', start: 540, end: 600, text: '早上段', taskIndex: null },
          { id: 'b', start: 840, end: 900, text: '下午段', taskIndex: null },
        ],
        answers: {},
        mood: null,
        score: null,
        habit: false,
        habitsDone: {},
      })
    )
    const ics = rangeToIcs(['2026-07-05', '2026-07-06'])
    expect(ics).not.toBeNull()
    expect((ics!.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2)
    expect(rangeToIcs(['2026-01-01'])).toBeNull()
  })
})
