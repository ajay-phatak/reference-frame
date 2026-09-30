// Buffered progress/log state for engine event streams. Engine events can
// arrive many times a second; setting React state per event re-renders the
// whole view each time. This hook accumulates into refs and flushes to state
// at most every FLUSH_MS, and caps stored log lines.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineEvent } from '../../../preload/index.d'
import { appendLog, applyProgress, type StageState } from './engineProgress'

const FLUSH_MS = 100

export interface EngineFeed {
  stageProgress: Record<string, StageState>
  logs: string[]
  // Feed one event; returns true if it was a progress/log event (buffered).
  handle: (e: EngineEvent) => boolean
  // Push any buffered updates to state immediately.
  flush: () => void
  reset: () => void
}

export function useEngineFeed(): EngineFeed {
  const [stageProgress, setStageProgress] = useState<Record<string, StageState>>({})
  const [logs, setLogs] = useState<string[]>([])
  const stageRef = useRef<Record<string, StageState>>({})
  const logsRef = useRef<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setStageProgress(stageRef.current)
    setLogs(logsRef.current)
  }, [])

  const schedule = useCallback((): void => {
    if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS)
  }, [flush])

  const handle = useCallback(
    (e: EngineEvent): boolean => {
      if (e.event === 'progress' && typeof e.stage === 'string') {
        stageRef.current = applyProgress(stageRef.current, e.stage, e)
        schedule()
        return true
      }
      if (e.event === 'log') {
        logsRef.current = appendLog(logsRef.current, String(e.msg ?? ''))
        schedule()
        return true
      }
      return false
    },
    [schedule]
  )

  const reset = useCallback((): void => {
    stageRef.current = {}
    logsRef.current = []
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setStageProgress({})
    setLogs([])
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return { stageProgress, logs, handle, flush, reset }
}
