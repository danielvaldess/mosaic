import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  completion,
  loadModel,
  unloadModel,
  QWEN3_4B_INST_Q4_K_M,
  QWEN3_600M_INST_Q4,
  type CompletionStats,
  type ModelProgressUpdate,
} from '@qvac/sdk'
import { logEvidence } from '../evidence/logger.js'
import { SYSTEM_PROMPT, EXTRACTION_SCHEMA, parseExtraction } from './prompt.js'
import type { Extraction } from '../types.js'

/**
 * Extracts the first valid JSON object from LLM output that may contain
 * markdown fences, explanations, or trailing text.
 */
function parseJsonResponse(raw: string): Extraction {
  // Strip <think>...</think> blocks (Qwen3 thinking tokens)
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  // Try fenced code block first (```json ... ```)
  const fenced = cleaned.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/)
  if (fenced?.[1]) return JSON.parse(fenced[1])
  // Find first complete JSON object using brace counting
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error(`Model did not return JSON: ${cleaned.slice(0, 200)}`)
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned.charAt(i)
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1))
      }
    }
  }
  throw new Error(`Model returned incomplete JSON: ${cleaned.slice(start, start + 200)}`)
}

type ModelProgressListener = (update: ModelProgressUpdate) => void
let modelProgressListener: ModelProgressListener | undefined

/** Lets the desktop shell surface first-run model download progress. */
export function setModelProgressListener(listener?: ModelProgressListener): void {
  modelProgressListener = listener
}

/**
 * QVAC model for extraction. Defaults to Qwen3-4B for the target GPU box;
 * override to a smaller/cached model for quick local demos:
 *   MOSAIC_EXTRACT_MODEL=small npm run cli
 */
export const EXTRACTION_MODEL =
  process.env.MOSAIC_EXTRACT_MODEL === 'small' ? QWEN3_600M_INST_Q4 : QWEN3_4B_INST_Q4_K_M

export const EXTRACTION_MODEL_NAME =
  process.env.MOSAIC_EXTRACT_MODEL === 'small' ? 'QWEN3_600M_INST_Q4' : 'QWEN3_4B_INST_Q4_K_M'

let loadedModelName = EXTRACTION_MODEL_NAME

/** Name of the model actually loaded (bundled file name wins). */
export function currentModelName(): string {
  return loadedModelName
}

/**
 * Strict JSON Schema the LLM must fill. Tolerant by design: every field is
 * optional except `equipment`, so partial observations remain valuable
 * (per the Philips brief: "without knowing the exact model or age, that
 * information should still be valuable").
 */

/** Runs one completion against the local QVAC model, returns parsed Extraction. */
export async function extractObservation(
  rawInput: string,
  modelId: string,
): Promise<{ extraction: Extraction; stats: CompletionStats | undefined }> {
  const start = Date.now()
  const result = completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rawInput },
    ],
    stream: false,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'observation_extraction',
        schema: EXTRACTION_SCHEMA,
      },
    },
  })

  const final = await result.final
  const stats = final.stats
  const raw = final.contentText.trim()

  logEvidence({
    ts: new Date().toISOString(),
    op: 'inference',
    model: currentModelName(),
    modelId,
    prompt: rawInput,
    promptTokens: stats?.promptTokens,
    outputTokens: stats?.generatedTokens,
    ttftMs: stats?.timeToFirstToken,
    tokensPerSec: stats?.tokensPerSecond,
    totalMs: Date.now() - start,
    backendDevice: stats?.backendDevice,
  })

  const extraction = parseJsonResponse(raw)
  return { extraction: parseExtraction(extraction), stats }
}

export async function loadExtractionModel() {
  const t0 = Date.now()
  // A cold machine can take well over the SDK's 30s default while antivirus
  // scans the bundled bare runtime; this only bounds the handshake.
  process.env['QVAC_RPC_INIT_TIMEOUT_MS'] ??= '180000'
  const reportProgress = (p: ModelProgressUpdate) => {
    const mb = (n: number) => (n / 1e6).toFixed(1)
    process.stderr.write(
      `▸ Loading model ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)\r`,
    )
    modelProgressListener?.(p)
  }
  const bundled = process.env['MOSAIC_MODEL_PATH']
  const usingBundled = bundled !== undefined && bundled !== '' && existsSync(bundled)
  const modelId = usingBundled
    ? await loadModel({
        modelSrc: bundled,
        modelType: 'llamacpp-completion',
        modelConfig: {
          ctx_size: 8192,
          gpu_layers: 99,
          device: 'gpu',
          'flash-attn': 'on',
          'main-gpu': 'dedicated',
          parallel: 2,
        } as Record<string, unknown>,
        onProgress: reportProgress,
      })
    : await loadModel({
        modelSrc: EXTRACTION_MODEL as typeof QWEN3_4B_INST_Q4_K_M,
        modelConfig: {
          ctx_size: 8192,
          gpu_layers: 99,
          device: 'gpu',
          'flash-attn': 'on',
          'main-gpu': 'dedicated',
          parallel: 2,
        } as Record<string, unknown>,
        onProgress: reportProgress,
      })
  loadedModelName = usingBundled && bundled ? basename(bundled) : EXTRACTION_MODEL_NAME
  logEvidence({
    ts: new Date().toISOString(),
    op: 'model_load',
    model: loadedModelName,
    modelId,
    totalMs: Date.now() - t0,
  })
  return modelId
}

export async function unloadExtractionModel(modelId: string) {
  const t0 = Date.now()
  await unloadModel({ modelId })
  logEvidence({
    ts: new Date().toISOString(),
    op: 'model_unload',
    model: EXTRACTION_MODEL_NAME,
    modelId,
    totalMs: Date.now() - t0,
  })
}
