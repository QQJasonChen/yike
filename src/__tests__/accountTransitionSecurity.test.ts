import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimDeviceFor, exportConflictAsFile, getDataOwner, getOpenAIKey, importAll,
  listConflicts, loadDay, openSyncGate, restoreBackup, saveConflictCopy, saveDay,
  setDataOwner, setOpenAIKey,
} from '../storage'
import { loadNotionConfig, saveNotionConfig } from '../integrations'
import { emptyDay, emptyTask } from '../types'

const A = 'synthetic-owner-a'
const B = 'synthetic-owner-b'
const DATE = '2026-10-14'
const KEY = `pp:day:${DATE}`
const STAMP = 1792000000123
const ID = `ppl:conflict:${STAMP}:${KEY}`
const day = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
const conflict = (text: string) => ({ __yike: 2, owner: B, at: STAMP, value: day(text) })
const file = (data: Record<string, unknown>) => JSON.stringify({ app: 'inkday-planner', version: 1, owner: B, data })

beforeEach(() => { openSyncGate(); localStorage.clear(); setDataOwner(A) })

describe('account transition credentials and independent rescue copies', () => {
  it('explicitly merging journal data into B never transfers A integration credentials or timer state', () => {
    saveDay(DATE, day('journal the user explicitly elected to merge'))
    setOpenAIKey('synthetic-openai-A', 'synthetic-model')
    saveNotionConfig({ token: 'synthetic-notion-A', parentPageId: 'aaaaaaaa-1111-2222-3333-444444444444', parentUrl: '' })
    localStorage.setItem('pp:sync', JSON.stringify({ token: 'synthetic-legacy-A' }))
    localStorage.setItem('ppl:timer', JSON.stringify({ taskText: 'synthetic-A private task' }))
    const journal = localStorage.getItem(KEY)

    claimDeviceFor(B)

    expect(getDataOwner()).toBe(B)
    expect(localStorage.getItem(KEY)).toBe(journal)
    expect(getOpenAIKey()).toBe('')
    expect(loadNotionConfig()).toBeNull()
    for (const key of ['ppl:openaiModel', 'pp:sync', 'ppl:timer']) expect(localStorage.getItem(key)).toBeNull()
  })

  it('first claim and repeat claim by the same user retain their own integration settings', () => {
    localStorage.removeItem('ppl:owner')
    setOpenAIKey('synthetic-first-owner', 'synthetic-model')
    claimDeviceFor(A)
    claimDeviceFor(A)
    expect(getOpenAIKey()).toBe('synthetic-first-owner')
  })

  it.each(['import', 'restore'] as const)('%s does not overwrite another owner conflict which shares the incoming ID', (mode) => {
    saveConflictCopy(KEY, day('A private rescue copy'), STAMP)
    const aRaw = localStorage.getItem(ID)
    setDataOwner(B)
    const incoming = conflict('B imported rescue copy')
    if (mode === 'import') importAll(file({ [ID]: incoming }))
    else {
      const backupId = `${DATE}#${B}`
      localStorage.setItem(`pp:bk:${backupId}`, JSON.stringify({ __yike: 2, owner: B, data: { [ID]: JSON.stringify(incoming) } }))
      restoreBackup(backupId)
    }

    expect(localStorage.getItem(ID)).toBe(aRaw)
    expect(listConflicts()).toHaveLength(1)
    expect(listConflicts()[0].at).toBe(STAMP)
    expect(JSON.parse(exportConflictAsFile(listConflicts()[0].id)).data[KEY].tasks[0].text).toBe('B imported rescue copy')
    setDataOwner(A)
    expect(JSON.parse(exportConflictAsFile(ID)).data[KEY].tasks[0].text).toBe('A private rescue copy')
  })

  it('import preserves different same-owner versions, and reimporting identical content is idempotent', () => {
    setDataOwner(B)
    saveConflictCopy(KEY, day('existing B version'), STAMP)
    importAll(file({ [ID]: conflict('imported B version') }))
    expect(listConflicts()).toHaveLength(2)
    importAll(file({ [ID]: conflict('imported B version') }))
    expect(listConflicts()).toHaveLength(2)
    expect(listConflicts().map(({ id }) => JSON.parse(exportConflictAsFile(id)).data[KEY].tasks[0].text).sort())
      .toEqual(['existing B version', 'imported B version'])
    expect(loadDay(DATE).tasks[0].text).toBe('')
  })
})
