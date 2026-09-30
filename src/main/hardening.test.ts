import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileAtomic } from './fsutil'
import { isSafeId, sanitizeConfigPatch } from './ids'
import * as library from './library'
import { EngineQueue } from './queue'

const opts: library.RunOptions = {
  me: 'left',
  meId: null,
  role: 'lead',
  partner: false,
  spotlight: false,
  poseModel: 'm',
  comparePros: false
}

describe('writeFileAtomic', () => {
  it('writes content and leaves no tmp files', () => {
    const d = mkdtempSync(join(tmpdir(), 'rf-'))
    const p = join(d, 'a.json')
    writeFileAtomic(p, 'one')
    writeFileAtomic(p, 'two')
    expect(readFileSync(p, 'utf-8')).toBe('two')
    expect(readdirSync(d)).toEqual(['a.json'])
  })
})

describe('isSafeId', () => {
  it('accepts run ids and rejects traversal', () => {
    expect(isSafeId('20260101-120000-clip-ab12cd')).toBe(true)
    for (const bad of ['', '..', 'a/b', 'a\\b', '..\\x', 'a..b', 'a b', 5, null]) {
      expect(isSafeId(bad)).toBe(false)
    }
  })
})

describe('sanitizeConfigPatch', () => {
  it('drops unknown keys and bad enums, keeps valid ones', () => {
    expect(
      sanitizeConfigPatch({ poseModel: 'x', coachModel: 'gpt', evil: 1, onboarded: true, notesFolder: null })
    ).toEqual({ poseModel: 'x', onboarded: true, notesFolder: null })
  })
})

describe('library hardening', () => {
  it('makeRunId differs within the same second', () => {
    const at = new Date()
    expect(library.makeRunId('/x/clip.mp4', at)).not.toBe(library.makeRunId('/x/clip.mp4', at))
  })

  it('sweepStale fails pending/queued runs, leaves done', () => {
    const d = mkdtempSync(join(tmpdir(), 'rf-'))
    const a = library.createRun(d, '/x/a.mp4', opts, null)
    const b = library.createRun(d, '/x/b.mp4', opts, null)
    library.setStatus(d, b.runId, 'queued')
    const c = library.createRun(d, '/x/c.mp4', opts, null)
    library.completeRun(d, c.runId, {})
    expect(library.sweepStale(d)).toBe(2)
    expect(library.readRun(d, a.runId)).toMatchObject({
      status: 'error',
      error: 'interrupted (app was closed)'
    })
    expect(library.readRun(d, c.runId)?.status).toBe('done')
  })
})

describe('EngineQueue.cancelAll', () => {
  it('cancels waiting tickets only', async () => {
    const q = new EngineQueue()
    await q.acquire('a')
    const pb = q.acquire('b')
    expect(q.cancelAll()).toEqual(['b'])
    await expect(pb).resolves.toBe('canceled')
    expect(q.snapshot()).toEqual({ active: 'a', waiting: [] })
  })
})
