import { createRequire } from 'node:module'

/**
 * Electron GUI apps run without a console, so every console-subsystem child
 * process gets its own visible console window on Windows. The QVAC SDK spawns
 * `bare.exe` (console binary) and electron-updater shells out to cmd/powershell
 * without passing `windowsHide`, which pops windows while the app runs.
 *
 * Dependencies are patched once at import time (before the SDK loads) so every
 * child process inherits `windowsHide: true` without editing node_modules.
 */
function apply(): void {
  const require = createRequire(import.meta.url)
  const cp = require('node:child_process') as Record<string, (...args: unknown[]) => unknown>
  const names = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'] as const
  for (const name of names) {
    const original = cp[name]
    if (typeof original !== 'function') continue
    cp[name] = (...args: unknown[]) => {
      const index = args.findIndex((arg) => arg !== null && typeof arg === 'object' && !Array.isArray(arg))
      if (index >= 0) args[index] = { ...(args[index] as object), windowsHide: true }
      return original(...args)
    }
  }
}

if (process.platform === 'win32') apply()
