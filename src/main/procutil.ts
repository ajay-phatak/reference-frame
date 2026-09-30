import { spawn, type ChildProcess } from 'child_process'

// child.kill() on Windows only terminates the direct child — for the
// PyInstaller exe (bootloader + real process) and `shell: true` (cmd.exe)
// that leaves the actual worker running. taskkill /T /F takes the whole tree.
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      tk.on('error', () => child.kill())
      return
    } catch {
      // fall through to the plain kill
    }
  }
  child.kill()
}
