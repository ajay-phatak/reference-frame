// Anthropic API key storage for the coach tier. The key lives ONLY as
// safeStorage ciphertext (DPAPI on Windows) in its own file under userData —
// deliberately outside config.json so a renderer config round-trip can never
// echo, expose, or clobber it. Plaintext exists only transiently in the main
// process; the renderer sees just { configured, last4 }.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs'

const keyPath = (): string => join(app.getPath('userData'), 'coach.key')

export interface KeyStatus {
  configured: boolean
  last4?: string
}

export function setKey(key: string): { ok: boolean; reason?: string } {
  const trimmed = key.trim()
  if (!trimmed) return clearKey()
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, reason: 'encryption_unavailable' }
  }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(keyPath(), safeStorage.encryptString(trimmed).toString('base64'))
  return { ok: true }
}

export function clearKey(): { ok: boolean } {
  rmSync(keyPath(), { force: true })
  return { ok: true }
}

/** Plaintext key for the Anthropic client. Main process only — never expose
 *  the return value over IPC. */
export function getKey(): string | null {
  try {
    const ciphertext = Buffer.from(readFileSync(keyPath(), 'utf-8'), 'base64')
    return safeStorage.decryptString(ciphertext)
  } catch {
    return null // missing file, or ciphertext from another OS user profile
  }
}

export function keyStatus(): KeyStatus {
  const key = getKey()
  if (!key) return { configured: false }
  return { configured: true, last4: key.slice(-4) }
}
