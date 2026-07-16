import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as pros from './pros'

// pros.ts's exported functions all take an explicit baseDir (defaulting to
// the real userData/pro_baselines dir only when omitted) precisely so this
// suite can exercise the manifest logic against a throwaway temp dir instead
// of touching Electron's app.getPath — see pros.ts's default-parameter design.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'refframe-pros-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('list', () => {
  it('is empty when no manifest exists yet', () => {
    expect(pros.list(dir)).toEqual([])
  })

  it('returns [] instead of throwing on a corrupt manifest', () => {
    writeFileSync(join(dir, 'baselines.json'), 'not json')
    expect(pros.list(dir)).toEqual([])
  })

  it('returns [] if the manifest is valid JSON but not an array', () => {
    writeFileSync(join(dir, 'baselines.json'), JSON.stringify({ oops: true }))
    expect(pros.list(dir)).toEqual([])
  })
})

describe('add', () => {
  it('appends an entry with a generated id + addedAt, preserving engine fields', () => {
    const added = pros.add(
      {
        label: 'Semion & Maria',
        couple: 'Semion & Maria',
        lead_id: 2,
        metrics: 'semion-maria.metrics.json'
      },
      dir
    )
    expect(added.id).toBeTruthy()
    expect(added.addedAt).toBeTruthy()
    expect(added.label).toBe('Semion & Maria')
    expect(added.lead_id).toBe(2)

    const entries = pros.list(dir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual(added)
  })

  it('writes a manifest the engine schema can round-trip (array of plain objects)', () => {
    pros.add({ label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' }, dir)
    const raw = JSON.parse(readFileSync(join(dir, 'baselines.json'), 'utf-8'))
    expect(Array.isArray(raw)).toBe(true)
    expect(raw[0]).toMatchObject({
      label: 'A',
      couple: 'A & B',
      lead_id: 1,
      metrics: 'a.metrics.json'
    })
  })

  it('appends rather than clobbering existing entries', () => {
    pros.add({ label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' }, dir)
    pros.add({ label: 'C', couple: 'C & D', lead_id: 2, metrics: 'c.metrics.json' }, dir)
    expect(pros.list(dir).map((e) => e.label)).toEqual(['A', 'C'])
  })
})

describe('remove', () => {
  it('drops the entry and deletes its metrics file', () => {
    writeFileSync(join(dir, 'a.metrics.json'), '{}')
    const added = pros.add(
      { label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' },
      dir
    )
    expect(pros.remove(added.id, dir)).toBe(true)
    expect(pros.list(dir)).toEqual([])
    expect(existsSync(join(dir, 'a.metrics.json'))).toBe(false)
  })

  it('returns false for an unknown id and leaves the manifest untouched', () => {
    pros.add({ label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' }, dir)
    expect(pros.remove('does-not-exist', dir)).toBe(false)
    expect(pros.list(dir)).toHaveLength(1)
  })

  it('does not throw if the metrics file is already missing', () => {
    const added = pros.add(
      { label: 'A', couple: 'A & B', lead_id: 1, metrics: 'missing.metrics.json' },
      dir
    )
    expect(() => pros.remove(added.id, dir)).not.toThrow()
    expect(pros.list(dir)).toEqual([])
  })
})

describe('activeProRefs', () => {
  it('is null with zero pros configured', () => {
    expect(pros.activeProRefs(dir)).toBeNull()
  })

  it('is the manifest path once at least one pro exists', () => {
    pros.add({ label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' }, dir)
    expect(pros.activeProRefs(dir)).toBe(join(dir, 'baselines.json'))
  })

  it('goes back to null after the last pro is removed', () => {
    const added = pros.add(
      { label: 'A', couple: 'A & B', lead_id: 1, metrics: 'a.metrics.json' },
      dir
    )
    pros.remove(added.id, dir)
    expect(pros.activeProRefs(dir)).toBeNull()
  })
})

describe('uniqueMetricsFilename', () => {
  it('slugifies the label', () => {
    expect(pros.uniqueMetricsFilename('Semion & Maria — WOTP 2024', dir)).toBe(
      'semion-maria-wotp-2024.metrics.json'
    )
  })

  it('falls back to "pro" for a label with no ascii-alnum characters', () => {
    expect(pros.uniqueMetricsFilename('!!!', dir)).toBe('pro.metrics.json')
  })

  it('disambiguates against an existing manifest entry with the same slug', () => {
    pros.add(
      {
        label: 'Semion & Maria',
        couple: 'Semion & Maria',
        lead_id: 1,
        metrics: 'semion-maria.metrics.json'
      },
      dir
    )
    expect(pros.uniqueMetricsFilename('Semion & Maria', dir)).toBe('semion-maria-2.metrics.json')
  })

  it('disambiguates against a stray file on disk even if not in the manifest', () => {
    writeFileSync(join(dir, 'semion-maria.metrics.json'), '{}')
    expect(pros.uniqueMetricsFilename('Semion & Maria', dir)).toBe('semion-maria-2.metrics.json')
  })
})
