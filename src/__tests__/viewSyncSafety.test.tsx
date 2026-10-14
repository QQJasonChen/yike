import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) }))
vi.mock('../ink', () => ({ ink: { available: async () => false } }))
vi.mock('../notify', () => ({ notifyAvailable: () => false, syncBlockReminders: vi.fn(), notify: { setDailyReminder: vi.fn() } }))
vi.mock('../focusLock', () => ({ focusLock: { stop: vi.fn() } }))
vi.mock('../pip', () => ({ openFloating: vi.fn(), pipAutoEnabled: () => false, pipSupported: () => false, setPipTimerSource: vi.fn() }))
vi.mock('../cloud', async () => ({ ...(await vi.importActual<typeof import('../cloud')>('../cloud')),
  cloudEnabled: () => false, startAutoSync: async () => {}, stopAutoSync: vi.fn() }))
// Test the actual period components' callbacks; avoid pointer geometry in jsdom.
vi.mock('../Gantt', () => ({ spanToCells: () => [], default: ({ title, rows, onCells }: { title: string; rows: { i: number }[]; onCells?: (index: number, cells: number[]) => void }) =>
  <button data-gantt-edit={title} onClick={() => onCells?.(rows[0]?.i ?? 0, [0])}>edit cells</button> }))
vi.mock('../Timeline', () => ({ default: ({ blocks, onChange }: { blocks: { id: string; text: string }[]; onChange: (blocks: unknown[]) => void }) =>
  <button data-timeline-edit onClick={() => onChange(blocks.map((b, i) => i ? b : { ...b, text: 'edited block' }))}>edit block</button> }))
vi.mock('../InkCanvas', () => ({ default: () => null }))
vi.mock('../ExportPanel', () => ({ default: () => null }))
vi.mock('../IapPanel', () => ({ default: () => null }))
import App from '../App'
import DayView from '../DayView'
import WeekView from '../WeekView'
import MonthView from '../MonthView'
import QuarterView from '../QuarterView'
import YearView from '../YearView'
import LifeView from '../LifeView'
import BizModelView from '../BizModelView'
import ScheduleView from '../ScheduleView'
import HabitWeek from '../HabitWeek'
import HistoryView from '../HistoryView'
import { clearUnsavedDrafts, hasUnsavedDrafts, useStoredEntry } from '../useStoredEntry'
import { EXTERNAL_KEY_EVENT } from '../useExternalKey'
import { loadDay, mondayOf, setDataOwner, saveDay, toDateKey, writeFromCloud } from '../storage'
import { defaultSettings, emptyBizModel, emptyDay, emptyLife, emptyMonth, emptyQuarter, emptyTask, emptyWeek, emptyYear } from '../types'

let container: HTMLDivElement, root: Root
const OWNER = 'synthetic-owner-a'
const DATE = '2026-09-01'
const settings = defaultSettings()
const noop = () => {}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); clearUnsavedDrafts(); setDataOwner(OWNER)
  localStorage.setItem('pp:onboarded', '1'); history.replaceState(null, '', '/')
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: noop, removeEventListener: noop })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearUnsavedDrafts(); vi.restoreAllMocks() })
const render = (node: ReactNode) => act(async () => root.render(node))
const external = (key: string) => act(async () => { window.dispatchEvent(new CustomEvent(EXTERNAL_KEY_EVENT, { detail: { key } })) })
const fill = (selector: string, value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`missing ${selector}`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const hydrate = (key: string, value: unknown) => writeFromCloud(key, value, 1788256800123)
const dayProps = { dateKey: DATE, onDateChange: noop, timer: null, onStartFocus: noop, settings,
  onSettingsChange: noop, registerSessionSink: noop, registerAbandonSink: noop }

const cases = [
  { name: 'Day', key: `pp:day:${DATE}`, selector: 'input.task-name', node: <DayView {...dayProps} />,
    value: (text: string, remote = false) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text, done: remote ? 5 : 0 }], answers: { untouched: remote ? 'remote-kept' : 'old' } }), },
  { name: 'Week', key: 'pp:week:2026-08-31', selector: '.week-task-row input', node: <WeekView mondayKey="2026-08-31" onWeekChange={noop} onOpenDay={noop} settings={settings} onSettingsChange={noop} />,
    value: (text: string, remote = false) => ({ ...emptyWeek(), tasks: emptyWeek().tasks.map((t, i) => i ? t : { ...t, text, done: remote }), review: { ...emptyWeek().review, wins: remote ? 'remote-kept' : 'old' } }), },
  { name: 'Month', key: 'pp:month:2026-09', selector: '.week-task-row input', node: <MonthView monthKey="2026-09" onMonthChange={noop} onOpenDay={noop} settings={settings} />,
    value: (text: string, remote = false) => ({ ...emptyMonth(), priorities: [{ text, done: remote }], highlights: remote ? 'remote-kept' : 'old' }), },
  { name: 'Quarter', key: 'pp:quarter:2026-Q3', selector: '.week-task-row input', node: <QuarterView quarterKey="2026-Q3" onQuarterChange={noop} settings={settings} />,
    value: (text: string, remote = false) => ({ ...emptyQuarter(), priorities: [{ text, done: remote }], highlights: remote ? 'remote-kept' : 'old' }), },
  { name: 'Year', key: 'pp:year:2026', selector: '.week-task-row input', node: <YearView year={2026} onYearChange={noop} onOpenDay={noop} settings={settings} />,
    value: (text: string, remote = false) => ({ ...emptyYear(), goals: [{ text, done: remote }], notes: { untouched: remote ? 'remote-kept' : 'old' } }), },
  { name: 'Life', key: 'pp:life', selector: '.week-task-row input', node: <LifeView />,
    value: (text: string, remote = false) => ({ ...emptyLife(), goals: [{ text, done: remote }], northStar: remote ? 'remote-kept' : 'old' }), },
  { name: 'Biz', key: 'pp:bizmodel', selector: 'input[placeholder="寫一項⋯"]', node: <BizModelView />,
    value: (text: string, remote = false) => ({ ...emptyBizModel(), value: [{ text, tag: remote ? 'remote-kept' : 'old' }], revenue: [{ text: remote ? 'remote-kept' : 'old' }] }), },
]

describe('actual rendered period views protect latest storage', () => {
  for (const test of cases) {
    it(`${test.name}: external pull is visible, then editing preserves the other device's fields`, async () => {
      hydrate(test.key, test.value('old')); await render(test.node)
      hydrate(test.key, test.value('remote', true)); await external(test.key)
      expect(container.querySelector<HTMLInputElement>(test.selector)!.value).toBe('remote')
      await fill(test.selector, 'local edit')
      expect(JSON.parse(localStorage.getItem(test.key)!)).toEqual(test.value('local edit', true))
      expect(localStorage.getItem(test.key)).toContain('local edit')
    })
    it(`${test.name}: edit before the event arrives also preserves newer stored fields`, async () => {
      hydrate(test.key, test.value('old')); await render(test.node)
      hydrate(test.key, test.value('remote', true))
      expect(container.querySelector<HTMLInputElement>(test.selector)!.value).toBe('old')
      await fill(test.selector, 'local edit')
      expect(JSON.parse(localStorage.getItem(test.key)!)).toEqual(test.value('local edit', true))
      expect(localStorage.getItem(test.key)).toContain('local edit')
    })
  }
  it('Schedule applies cells to latest week without reverting remote text/review', async () => {
    const key = `pp:week:${mondayOf(toDateKey(new Date()))}`
    hydrate(key, { ...emptyWeek(), tasks: [{ ...emptyWeek().tasks[0], text: 'old' }] })
    await render(<ScheduleView />)
    hydrate(key, { ...emptyWeek(), tasks: [{ ...emptyWeek().tasks[0], text: 'remote-kept' }], intention: 'remote-intention' })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-gantt-edit="本週甘特"]')!.click())
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ tasks: [{ text: 'remote-kept', cells: [0] }], intention: 'remote-intention' })
  })
  it('HabitWeek toggles one habit without replacing newer day contents or another habit', async () => {
    hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'old' }] })
    await render(<HabitWeek mondayKey={DATE} settings={{ ...settings, habits: ['Read'] }} onSettingsChange={noop} />)
    hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'remote-kept' }], habitsDone: { other: true } })
    await act(async () => container.querySelector<HTMLButtonElement>('.hw-check')!.click())
    expect(loadDay(DATE)).toMatchObject({ tasks: [{ text: 'remote-kept' }], habitsDone: { Read: true, other: true } })
  })
  it('Timeline preserves remote additions and changed time when an old frame edits only text', async () => {
    const key = `pp:day:${DATE}`
    const original = { id: 'block-a', text: 'old', start: 600, end: 660 }
    hydrate(key, { ...emptyDay(), blocks: [original] }); await render(<DayView {...dayProps} />)
    hydrate(key, { ...emptyDay(), blocks: [{ ...original, start: 700, end: 760 }, { id: 'remote-add', text: 'remote kept', start: 800, end: 830 }] })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-timeline-edit]')!.click())
    expect(loadDay(DATE).blocks).toEqual([
      { ...original, text: 'edited block', start: 700, end: 760 },
      { id: 'remote-add', text: 'remote kept', start: 800, end: 830 },
    ])
  })
  it('local authenticated owner-ready reloads the fresh buyer view and permits its first edit', async () => {
    localStorage.clear(); await render(<DayView {...dayProps} />)
    setDataOwner('fresh-buyer'); hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'fresh cloud' }] })
    await act(async () => window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner: 'fresh-buyer' } })))
    expect(container.querySelector<HTMLInputElement>('input.task-name')!.value).toBe('fresh cloud')
    await fill('input.task-name', 'first buyer edit')
    expect(loadDay(DATE).tasks[0].text).toBe('first buyer edit')
  })
  it('a stale asynchronous editor cannot write into the next date after navigation', async () => {
    const callbacks: ((value: string) => void)[] = []
    // Probe the same hook used by native ink and keyed period controls.
    const Probe = ({ date }: { date: string }) => {
      const { edit } = useStoredEntry(`pp:day:${date}`, () => loadDay(date), (value) => saveDay(date, value))
      callbacks.push((text) => { edit((base) => ({ ...base, tasks: [{ ...emptyTask(), text }] })) })
      return <span>{date}</span>
    }
    await render(<Probe date={DATE} />)
    const old = callbacks[callbacks.length - 1]
    await render(<Probe date="2026-09-02" />)
    await act(async () => old('late ink/editor'))
    expect(loadDay('2026-09-02').tasks[0].text).toBe('')
    expect(loadDay(DATE).tasks[0].text).toBe('')
  })
  it('History import cancellation keeps all data and owner unchanged', async () => {
    hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'retained' }] })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await render(<HistoryView onOpenDay={noop} settings={settings} />)
    const file = JSON.stringify({ app: 'inkday-planner', version: 1, owner: 'another-owner', data: { [`pp:day:${DATE}`]: { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'other' }] } } })
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => file }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(loadDay(DATE).tasks[0].text).toBe('retained')
  })
  it('History invalidates import confirmation if owner changes during the dialog', async () => {
    hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'retained' }] })
    vi.spyOn(window, 'confirm').mockImplementation(() => { setDataOwner('changed-owner'); return true })
    const alert = vi.spyOn(window, 'alert').mockImplementation(noop)
    await render(<HistoryView onOpenDay={noop} settings={settings} />)
    const file = JSON.stringify({ app: 'inkday-planner', version: 1, owner: 'another-owner', data: { [`pp:day:${DATE}`]: { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'other' }] } } })
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => file }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(loadDay(DATE).tasks[0].text).toBe('retained')
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('帳號已變更'))
  })
  it('another owner blocks the stale view even before a storage event arrives', async () => {
    hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'A' }] }); await render(<DayView {...dayProps} />)
    setDataOwner('synthetic-owner-b'); hydrate(`pp:day:${DATE}`, { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'B' }] })
    await fill('input.task-name', 'A stale edit')
    expect(loadDay(DATE).tasks[0].text).toBe('B')
  })
  it('failed local save is visible in App and the draft survives later edits and remount', async () => {
    await render(<App />)
    const key = `pp:day:${toDateKey(new Date())}`
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, k, v) {
      if (k === key) throw new DOMException('quota', 'QuotaExceededError')
      original.call(this, k, v)
    })
    await fill('input.task-name', 'unsaved one')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('儲存沒有完成')
    expect(hasUnsavedDrafts()).toBe(true)
    await fill('input.task-name', 'unsaved two')
    expect(container.querySelector<HTMLInputElement>('input.task-name')!.value).toBe('unsaved two')
    await render(<div />); await render(<App />)
    expect(container.querySelector<HTMLInputElement>('input.task-name')!.value).toBe('unsaved two')
    spy.mockRestore()
    await fill('input.task-name', 'now saved')
    expect(loadDay(toDateKey(new Date())).tasks[0].text).toBe('now saved')
    expect(hasUnsavedDrafts()).toBe(false)
  })
  it('App masks and unmounts old records on another tab owner change', async () => {
    await render(<App />)
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'ppl:owner', oldValue: OWNER, newValue: 'owner-b' })))
    expect(container.textContent).toContain('已停止此畫面的編輯與同步')
    expect(container.querySelector('input.task-name')).toBeNull()
  })
})
