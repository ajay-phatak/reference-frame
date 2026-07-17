import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { upsertBlock } from './writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rf-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('upsertBlock — new file', () => {
  it('creates parent dirs, writes frontmatter, then the marked block', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: 'Sessions/2026-07-16.md',
      kind: 'run',
      key: '20260716-142530-my-video',
      content: '## Run My Video\n\nsome content',
      frontmatter: { generator: 'refframe', date: '2026-07-16' }
    })
    expect(res.ok).toBe(true)
    const path = join(root, 'Sessions', '2026-07-16.md')
    expect(existsSync(path)).toBe(true)
    const text = readFileSync(path, 'utf-8')
    expect(text.startsWith('---\ngenerator: refframe\ndate: 2026-07-16\n---\n\n')).toBe(true)
    expect(text).toContain('<!-- refframe:begin run 20260716-142530-my-video -->')
    expect(text).toContain('## Run My Video')
    expect(text).toContain('<!-- refframe:end run 20260716-142530-my-video -->')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('omits frontmatter entirely when none is passed', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: 'Progress.md',
      kind: 'focuses',
      key: 'current',
      content: '## Focuses'
    })
    expect(res.ok).toBe(true)
    const text = readFileSync(join(root, 'Progress.md'), 'utf-8')
    expect(text.startsWith('---')).toBe(false)
    expect(text.startsWith('<!-- refframe:begin focuses current -->')).toBe(true)
  })
})

describe('upsertBlock — append to existing file', () => {
  it('preserves prior content byte-for-byte and separates with one blank line', () => {
    const path = join(root, 'Progress.md')
    const prior = '# Progress\n\nSome hand-written notes here.\n- bullet one\n- bullet two\n'
    writeFileSync(path, prior)

    const res = upsertBlock({
      notesFolder: root,
      relPath: 'Progress.md',
      kind: 'focuses',
      key: 'current',
      content: '## Focuses\n\n- **Gap** — plan'
    })
    expect(res.ok).toBe(true)
    const text = readFileSync(path, 'utf-8')
    expect(text.startsWith(prior.replace(/\s+$/, ''))).toBe(true)
    expect(text).toContain('\n\n<!-- refframe:begin focuses current -->')
    expect(text).toContain('## Focuses')
    expect(text.endsWith('\n')).toBe(true)
    // Everything that was there before is untouched.
    expect(text).toContain('bullet one')
    expect(text).toContain('bullet two')
  })
})

describe('upsertBlock — upsert in place', () => {
  it('replaces only the block, leaving foreign content before and after byte-identical', () => {
    const path = join(root, 'Sessions', '2026-07-16.md')
    mkdirSync(join(root, 'Sessions'), { recursive: true })
    const before = '# Canary before\n\nHand-written paragraph that must survive.\n\n'
    const after = '\n\n## Notes\n\n- my own bullet\n'
    const original =
      before +
      '<!-- refframe:begin run r1 -->\n## Run Old Title\n\nold content\n<!-- refframe:end run r1 -->' +
      after
    writeFileSync(path, original)

    const res = upsertBlock({
      notesFolder: root,
      relPath: 'Sessions/2026-07-16.md',
      kind: 'run',
      key: 'r1',
      content: '## Run New Title\n\nnew content'
    })
    expect(res.ok).toBe(true)
    const text = readFileSync(path, 'utf-8')
    expect(text.startsWith(before)).toBe(true)
    expect(text.endsWith(after)).toBe(true)
    expect(text).toContain('## Run New Title')
    expect(text).not.toContain('## Run Old Title')
    expect(text).toContain('Hand-written paragraph that must survive.')
    expect(text).toContain('my own bullet')
  })

  it('is idempotent: upserting the same content twice yields identical bytes', () => {
    const first = upsertBlock({
      notesFolder: root,
      relPath: 'Progress.md',
      kind: 'focuses',
      key: 'current',
      content: '## Focuses\n\n- **Gap** — plan'
    })
    expect(first.ok).toBe(true)
    const afterFirst = readFileSync(join(root, 'Progress.md'), 'utf-8')

    const second = upsertBlock({
      notesFolder: root,
      relPath: 'Progress.md',
      kind: 'focuses',
      key: 'current',
      content: '## Focuses\n\n- **Gap** — plan'
    })
    expect(second.ok).toBe(true)
    const afterSecond = readFileSync(join(root, 'Progress.md'), 'utf-8')
    expect(afterSecond).toBe(afterFirst)
  })
})

describe('upsertBlock — safety', () => {
  it('refuses to write when the begin marker exists but the end marker is missing', () => {
    const path = join(root, 'Progress.md')
    const broken = 'stuff\n<!-- refframe:begin focuses current -->\nno end marker here\n'
    writeFileSync(path, broken)

    const res = upsertBlock({
      notesFolder: root,
      relPath: 'Progress.md',
      kind: 'focuses',
      key: 'current',
      content: 'new content'
    })
    expect(res.ok).toBe(false)
    expect(readFileSync(path, 'utf-8')).toBe(broken)
  })

  it('rejects relative-path traversal out of notesFolder', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: '../escaped.md',
      kind: 'run',
      key: 'r1',
      content: 'x'
    })
    expect(res.ok).toBe(false)
    expect(existsSync(join(root, '..', 'escaped.md'))).toBe(false)
  })

  it('rejects an absolute relPath', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: join(root, 'x.md'),
      kind: 'run',
      key: 'r1',
      content: 'x'
    })
    expect(res.ok).toBe(false)
  })

  it('rejects an invalid kind', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: 'x.md',
      kind: 'run kind',
      key: 'r1',
      content: 'x'
    })
    expect(res.ok).toBe(false)
  })

  it('rejects an invalid key', () => {
    const res = upsertBlock({
      notesFolder: root,
      relPath: 'x.md',
      kind: 'run',
      key: '../nope',
      content: 'x'
    })
    expect(res.ok).toBe(false)
  })
})
