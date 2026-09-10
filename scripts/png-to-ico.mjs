import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Wraps a 256x256 PNG into a single-entry .ico (PNG-compressed entry),
 * which Windows Vista+ and electron-builder accept. No dependencies.
 */
const input = resolve(process.argv[2] ?? 'build/icon.png')
const output = resolve(process.argv[3] ?? 'build/icon.ico')

const png = readFileSync(input)
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${input} is not a PNG`)
const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
if (width !== 256 || height !== 256) {
  throw new Error(`Expected a 256x256 PNG, got ${width}x${height}: ${input}`)
}

const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // image count

const entry = Buffer.alloc(16)
entry[0] = 0 // width 256 is encoded as 0
entry[1] = 0 // height 256 is encoded as 0
entry.writeUInt16LE(1, 4) // color planes
entry.writeUInt16LE(32, 6) // bits per pixel
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(6 + 16, 12) // data offset

writeFileSync(output, Buffer.concat([header, entry, png]))
console.log(`• Wrote ${output} from ${width}x${height} PNG (${png.length} bytes)`)
