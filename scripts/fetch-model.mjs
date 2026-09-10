import { createHash } from 'node:crypto'
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Prepares AI models for the offline installer: reads them from the QVAC cache
 * or downloads them through the SDK registry, verifies the SHA-256 and copies
 * them into assets/models/ so electron-builder bundles them.
 *
 * Usage:
 *   node scripts/fetch-model.mjs                 # extraction (Qwen3-4B)
 *   node scripts/fetch-model.mjs extraction-small
 *   node scripts/fetch-model.mjs --all --force
 */
const MODELS = {
  // Qwen3-4B (~2.5 GB) does not fit: NSIS installers are capped at ~2 GB.
  extraction: {
    label: 'Qwen3-1.7B Q4_0 (extracción general, GPU/CPU)',
    file: 'Qwen3-1.7B-Q4_0.gguf',
    sha256: 'c876f159707a4e4f70e045106c69db15bfc935a4981706fd4f65c6e7ea1e81c5',
    constant: 'QWEN3_1_7B_INST_Q4',
  },
  'extraction-small': {
    label: 'Qwen3-0.6B Q4_0 (extracción liviana)',
    file: 'Qwen3-0.6B-Q4_0.gguf',
    sha256: '33bcc57074ec7b6eada5a90651ee546ec0c2b271002c22baf9f1b2dd1e8f75cb',
    constant: 'QWEN3_600M_INST_Q4',
  },
}

const cacheDir = join(homedir(), '.qvac', 'models')
const outDir = resolve('assets', 'models')

// Cold machines can exceed the SDK's 30s default while antivirus scans bare.exe.
process.env['QVAC_RPC_INIT_TIMEOUT_MS'] ??= '180000'

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function findCached(model) {
  if (!existsSync(cacheDir)) return undefined
  const match = readdirSync(cacheDir).find((name) => name === model.file || name.endsWith('_' + model.file))
  return match ? join(cacheDir, match) : undefined
}

function human(bytes) {
  return (bytes / 1024 ** 3).toFixed(2) + ' GB'
}

async function install(name, force) {
  const model = MODELS[name]
  if (!model) throw new Error(`Unknown model "${name}". Options: ${Object.keys(MODELS).join(', ')}`)
  mkdirSync(outDir, { recursive: true })
  const target = join(outDir, model.file)

  if (!force && existsSync(target)) {
    if (await sha256(target) === model.sha256) {
      console.log(`• ${model.file} ya está listo en assets/models`)
      return
    }
    console.log(`• ${model.file} no coincide con el checksum; se reemplaza`)
    rmSync(target, { force: true })
  }

  let source = findCached(model)
  if (source && await sha256(source) !== model.sha256) source = undefined

  if (!source) {
    console.log(`▸ Descargando ${model.label} desde el registro QVAC…`)
    const sdk = await import('@qvac/sdk')
    const descriptor = sdk[model.constant]
    if (!descriptor) throw new Error(`El SDK no exporta ${model.constant}`)
    await sdk.downloadAsset({
      assetSrc: descriptor,
      onProgress: (progress) => {
        process.stderr.write(`▸ ${progress.percentage.toFixed(0)}% (${human(progress.downloaded)}/${human(progress.total)})\r`)
      },
    })
    process.stderr.write('\n')
    source = findCached(model)
    if (!source) throw new Error('La descarga terminó pero no se encontró el archivo en la caché de QVAC')
  }

  if (await sha256(source) !== model.sha256) {
    throw new Error(`Checksum inválido para ${model.file}; descarga corrupta`)
  }
  copyFileSync(source, target)
  console.log(`• ${model.file} → assets/models (${human(statSync(target).size)})`)
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const all = args.includes('--all')
const names = args.filter((arg) => !arg.startsWith('--'))
const targets = all ? Object.keys(MODELS) : names.length ? names : ['extraction']

for (const name of targets) {
  try {
    await install(name, force)
  } catch (error) {
    console.error(`✖ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
