import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const copies = [
  ['src/web/chat.html', 'dist/web/chat.html'],
  ['src/web/onboarding.html', 'dist/web/onboarding.html'],
  ['src/web/mosaic-logo.png', 'dist/web/mosaic-logo.png'],
  ['src/server/index.html', 'dist/server/index.html'],
  ['src/electron/loading.html', 'dist/electron/loading.html'],
  ['src/web/mosaic-logo.png', 'dist/electron/mosaic-logo.png'],
]

for (const [from, to] of copies) {
  const target = resolve(to)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(resolve(from), target)
}

console.log(`• Copied ${copies.length} static assets to ${join('dist')}.`)
