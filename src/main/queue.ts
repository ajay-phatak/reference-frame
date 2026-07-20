// FIFO mutex serializing engine work. `engine:analyze` uses acquire() to wait
// its turn instead of being rejected when busy; every other engine-invoking
// IPC handler keeps today's reject-when-busy behavior via tryAcquire(), just
// routed through the same slot so a queued analyze and e.g. engine:setup
// can't run concurrently. Zero Electron imports — plain class, unit-tested
// directly (see queue.test.ts).

export type QueueTurn = 'run' | 'canceled'

export interface QueueSnapshot {
  active: string | null
  waiting: string[]
}

interface Waiter {
  id: string
  resolve: (turn: QueueTurn) => void
}

export class EngineQueue {
  private active: string | null = null
  private waiting: Waiter[] = []
  private listeners: Array<(snap: QueueSnapshot) => void> = []

  // Resolves 'run' once this id becomes the active ticket (immediately if the
  // queue is idle), or 'canceled' if cancel() removes it while still waiting.
  acquire(id: string): Promise<QueueTurn> {
    if (this.active === null) {
      this.active = id
      this.emit()
      return Promise.resolve('run')
    }
    return new Promise<QueueTurn>((resolve) => {
      this.waiting.push({ id, resolve })
      this.emit()
    })
  }

  // Succeeds only when the queue is completely idle — the interactive flows
  // (setup, seed-preview, pros add) want today's busy-reject, not a queue.
  tryAcquire(id: string): boolean {
    if (this.active !== null || this.waiting.length > 0) return false
    this.active = id
    this.emit()
    return true
  }

  // No-op unless `id` is the current active ticket — guards double-release
  // (a second call sees `active` already moved on, or null) from starting
  // the next waiter twice.
  release(id: string): void {
    if (this.active !== id) return
    this.active = null
    this.emit()
    const next = this.waiting.shift()
    if (next) {
      this.active = next.id
      this.emit()
      next.resolve('run')
    }
  }

  // Only removes a WAITING ticket — the active ticket isn't the queue's
  // business (the running engine job has its own cancel path). Returns false
  // for an unknown id or the active id.
  cancel(id: string): boolean {
    const idx = this.waiting.findIndex((w) => w.id === id)
    if (idx === -1) return false
    const [w] = this.waiting.splice(idx, 1)
    this.emit()
    w.resolve('canceled')
    return true
  }

  snapshot(): QueueSnapshot {
    return { active: this.active, waiting: this.waiting.map((w) => w.id) }
  }

  // Fired on every state transition (enqueue, start, release, cancel).
  // Returns an unsubscribe function.
  onChange(cb: (snap: QueueSnapshot) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
  }
}
