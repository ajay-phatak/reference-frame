import { writeFileSync, renameSync, rmSync } from 'fs'

// tmp + rename so a crash or power loss mid-write can never leave a truncated
// config.json / run.json / coach.key behind. Same-directory tmp keeps the
// rename on one volume (atomic on NTFS and POSIX).
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best-effort
    }
    throw err
  }
}
