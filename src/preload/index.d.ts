import { ElectronAPI } from '@electron-toolkit/preload'

// NDJSON event contract shared with the refframe-engine sidecar.
export interface EngineEvent {
  event: 'progress' | 'log' | 'result' | 'error'
  stage?: string
  current?: number
  total?: number
  detail?: string
  msg?: string
  [key: string]: unknown
}

export interface AppConfig {
  onboarded: boolean
}

export interface UpdateCheck {
  current: string
  latest: string | null
  newer: boolean
  url?: string
}

export interface ReferenceFrameApi {
  checkUpdate: () => Promise<UpdateCheck>
  getConfig: () => Promise<AppConfig>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ReferenceFrameApi
  }
}
