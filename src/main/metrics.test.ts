import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readMetrics } from './metrics'

// readMetrics takes a bare path (no baseDir/Electron dependency) precisely so
// this suite can point it at throwaway fixture files — see metrics.ts's
// design note and pros.test.ts for the same pattern.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'refframe-metrics-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeFixture(name: string, data: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(data))
  return p
}

describe('readMetrics', () => {
  it('parses a realistic nested fixture, keeping scalars and nested scalar objects', () => {
    const p = writeFixture('run_metrics.json', {
      camera_setup: {
        view_angle: 'side-on',
        camera_elevation: 'level',
        size_ratio: 1.02,
        notes: ['lead appears larger']
      },
      tracking_quality: {
        lead: { frames_tracked: 900, total_frames: 1000, coverage_pct: 90.0 },
        follow: { frames_tracked: 850, total_frames: 1000, coverage_pct: 85.0 }
      },
      leg_action_lead: {
        step_count_total: 42,
        knee_flex_mean: 0.271,
        rise_fall_typical: null,
        step_data: [0.1, 0.2, 0.3]
      },
      spotlight: true
    })

    const result = readMetrics(p)

    expect(result).toEqual({
      camera_setup: {
        view_angle: 'side-on',
        camera_elevation: 'level',
        size_ratio: 1.02
        // notes (array) dropped
      },
      tracking_quality: {
        lead: { frames_tracked: 900, total_frames: 1000, coverage_pct: 90.0 },
        follow: { frames_tracked: 850, total_frames: 1000, coverage_pct: 85.0 }
      },
      leg_action_lead: {
        step_count_total: 42,
        knee_flex_mean: 0.271,
        rise_fall_typical: null
        // step_data (array) dropped
      },
      spotlight: true
    })
  })

  it('drops arrays at every nesting depth', () => {
    const p = writeFixture('arrays.json', {
      musicality: {
        beat_times: [1, 2, 3],
        tempo_bpm: 92.3
      },
      movement_quality_detail: {
        lead: {
          dist_weighted_knee: { p50: 30, p90: 55, samples: [1, 2, 3] }
        }
      }
    })

    const result = readMetrics(p)

    expect(result).toEqual({
      musicality: { tempo_bpm: 92.3 },
      movement_quality_detail: {
        lead: { dist_weighted_knee: { p50: 30, p90: 55 } }
      }
    })
  })

  it('returns null for a missing file', () => {
    expect(readMetrics(join(dir, 'does-not-exist.json'))).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, '{ not valid json')
    expect(readMetrics(p)).toBeNull()
  })

  it('returns null when the top level is not an object', () => {
    const p = writeFixture('array-top.json', [1, 2, 3])
    expect(readMetrics(p)).toBeNull()
  })

  it('preserves unknown/extra sections untouched (engine drift forward)', () => {
    const p = writeFixture('extra.json', {
      some_new_section: { foo: 'bar', count: 3 }
    })
    expect(readMetrics(p)).toEqual({
      some_new_section: { foo: 'bar', count: 3 }
    })
  })

  it('yields a partial result rather than throwing when fields are missing/null', () => {
    const p = writeFixture('partial.json', {
      weight_countering: { counter_balance_pct: null }
    })
    expect(readMetrics(p)).toEqual({
      weight_countering: { counter_balance_pct: null }
    })
  })
})
