import { describe, it, expect } from 'vitest'
import { EngineQueue, type QueueSnapshot } from './queue'

// acquire()'s waiting-branch resolves synchronously inside release()/cancel()
// (no timers involved), so `await` on the returned promise is enough to
// observe the transition — no fake timers or real sleeps needed.

describe('acquire', () => {
  it('resolves the first ticket immediately', async () => {
    const q = new EngineQueue()
    await expect(q.acquire('a')).resolves.toBe('run')
    expect(q.snapshot()).toEqual({ active: 'a', waiting: [] })
  })

  it('keeps FIFO order across three tickets', async () => {
    const q = new EngineQueue()
    const order: string[] = []

    const pa = q.acquire('a').then((t) => {
      if (t === 'run') order.push('a')
    })
    const pb = q.acquire('b').then((t) => {
      if (t === 'run') order.push('b')
    })
    const pc = q.acquire('c').then((t) => {
      if (t === 'run') order.push('c')
    })

    await pa
    expect(q.snapshot()).toEqual({ active: 'a', waiting: ['b', 'c'] })

    q.release('a')
    await pb
    expect(q.snapshot()).toEqual({ active: 'b', waiting: ['c'] })

    q.release('b')
    await pc
    expect(q.snapshot()).toEqual({ active: 'c', waiting: [] })

    expect(order).toEqual(['a', 'b', 'c'])
  })
})

describe('tryAcquire', () => {
  it('succeeds when the queue is idle', () => {
    const q = new EngineQueue()
    expect(q.tryAcquire('a')).toBe(true)
    expect(q.snapshot()).toEqual({ active: 'a', waiting: [] })
  })

  it('fails while a ticket is active', () => {
    const q = new EngineQueue()
    q.tryAcquire('a')
    expect(q.tryAcquire('b')).toBe(false)
    expect(q.snapshot()).toEqual({ active: 'a', waiting: [] })
  })

  it('fails while a ticket is only waiting (queue non-empty, not just non-idle active)', async () => {
    const q = new EngineQueue()
    await q.acquire('a') // becomes active
    q.acquire('b') // waits
    expect(q.tryAcquire('c')).toBe(false)
  })

  it('succeeds again once released back to idle', () => {
    const q = new EngineQueue()
    q.tryAcquire('a')
    q.release('a')
    expect(q.tryAcquire('b')).toBe(true)
  })
})

describe('release', () => {
  it('is a no-op for a non-active id and cannot double-start the next waiter', async () => {
    const q = new EngineQueue()
    await q.acquire('a')
    let bStarted = 0
    const pb = q.acquire('b').then((t) => {
      if (t === 'run') bStarted++
    })

    q.release('not-active') // no-op
    expect(q.snapshot().active).toBe('a')

    q.release('a')
    await pb
    expect(bStarted).toBe(1)
    expect(q.snapshot().active).toBe('b')

    q.release('a') // stale/duplicate release of the ticket that already left
    await Promise.resolve()
    expect(bStarted).toBe(1) // b did not get started twice
    expect(q.snapshot().active).toBe('b')
  })
})

describe('cancel', () => {
  it('resolves a waiting ticket as canceled and skips it at drain time', async () => {
    const q = new EngineQueue()
    await q.acquire('a')
    const bTurn = q.acquire('b')
    const pc = q.acquire('c')

    expect(q.cancel('b')).toBe(true)
    await expect(bTurn).resolves.toBe('canceled')
    expect(q.snapshot()).toEqual({ active: 'a', waiting: ['c'] })

    q.release('a')
    await expect(pc).resolves.toBe('run')
    expect(q.snapshot()).toEqual({ active: 'c', waiting: [] })
  })

  it('returns false for an unknown id', () => {
    const q = new EngineQueue()
    q.tryAcquire('a')
    expect(q.cancel('does-not-exist')).toBe(false)
  })

  it('returns false for the active id (not the queue\'s business)', () => {
    const q = new EngineQueue()
    q.tryAcquire('a')
    expect(q.cancel('a')).toBe(false)
    expect(q.snapshot().active).toBe('a')
  })
})

describe('snapshot', () => {
  it('reports active + waiting in arrival order', async () => {
    const q = new EngineQueue()
    await q.acquire('a')
    q.acquire('b')
    q.acquire('c')
    expect(q.snapshot()).toEqual({ active: 'a', waiting: ['b', 'c'] })
  })
})

describe('onChange', () => {
  it('fires on enqueue, start, release, and cancel', async () => {
    const q = new EngineQueue()
    const snaps: QueueSnapshot[] = []
    const unsubscribe = q.onChange((snap) => snaps.push(snap))

    await q.acquire('a') // start
    q.acquire('b') // enqueue
    q.cancel('b') // cancel
    q.release('a') // release

    expect(snaps.length).toBeGreaterThanOrEqual(4)
    expect(snaps[0]).toEqual({ active: 'a', waiting: [] })
    expect(snaps.at(-1)).toEqual({ active: null, waiting: [] })

    unsubscribe()
    q.tryAcquire('c')
    expect(snaps.length).toBe(4) // no more callbacks after unsubscribe
  })
})
