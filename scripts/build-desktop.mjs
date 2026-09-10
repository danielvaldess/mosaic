import { spawnSync } from 'node:child_process'

/**
 * Builds the Windows installer. With --offline it first fetches the bundled
 * model into assets/models/, so the resulting .exe works without internet.
 */
const offline = process.argv.includes('--offline')

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (offline) {
  run('node', ['scripts/fetch-model.mjs', 'extraction'])
}
run('npx', ['electron-builder', '--win'])
