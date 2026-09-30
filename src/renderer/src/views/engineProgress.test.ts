import { describe, expect, it } from 'vitest'
import {
  appendLog,
  applyProgress,
  friendlyError,
  isCanceledMessage,
  validatePicks
} from './engineProgress'

describe('friendlyError', () => {
  it('strips the Electron IPC wrapper and Error prefix', () => {
    expect(
      friendlyError(new Error("Error invoking remote method 'analyze:run': Error: engine exploded"))
    ).toBe('engine exploded')
  })
  it('strips a bare Error: prefix from strings', () => {
    expect(friendlyError('Error: nope')).toBe('nope')
    expect(friendlyError(new TypeError('bad'))).toBe('bad')
  })
  it('passes plain messages through and never returns empty', () => {
    expect(friendlyError('canceled')).toBe('canceled')
    expect(friendlyError('')).toBe('Unknown error')
  })
})

describe('isCanceledMessage', () => {
  it('matches only canceled', () => {
    expect(isCanceledMessage('canceled')).toBe(true)
    expect(isCanceledMessage("Error invoking remote method 'x': Error: canceled")).toBe(true)
    expect(isCanceledMessage('canceled by engine crash')).toBe(false)
    expect(isCanceledMessage(null)).toBe(false)
  })
})

describe('appendLog', () => {
  it('caps at the limit keeping the newest lines', () => {
    let logs: string[] = []
    for (let i = 0; i < 10; i++) logs = appendLog(logs, String(i), 4)
    expect(logs).toEqual(['6', '7', '8', '9'])
  })
})

describe('applyProgress', () => {
  it('keeps the first startedAt and defaults missing numbers', () => {
    const a = applyProgress({}, 'extract', { current: 1, total: 10 }, 100)
    const b = applyProgress(a, 'extract', { current: 5, total: 10, detail: 'x' }, 200)
    expect(b.extract).toEqual({ current: 5, total: 10, detail: 'x', startedAt: 100 })
    expect(applyProgress({}, 's', {}, 1).s).toMatchObject({ current: 0, total: 0 })
  })
})

describe('validatePicks', () => {
  const dets = [{ idx: 0 }, { idx: 1 }, { idx: 2 }]
  it('requires both, distinct, present', () => {
    expect(validatePicks(null, 1, dets)).not.toBeNull()
    expect(validatePicks(1, 1, dets)).toMatch(/different/)
    expect(validatePicks(1, 9, dets)).toMatch(/detected/)
    expect(validatePicks(1, 2, null)).not.toBeNull()
    expect(validatePicks(0, 2, dets)).toBeNull()
  })
})
