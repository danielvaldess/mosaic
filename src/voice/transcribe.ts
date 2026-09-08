import {
  loadModel,
  transcribe,
  unloadModel,
  WHISPER_TINY,
  type ModelProgressUpdate,
} from '@qvac/sdk'
import { logEvidence } from '../evidence/logger.js'

export const WHISPER_MODEL = WHISPER_TINY

export async function loadVoiceModel() {
  const t0 = Date.now()
  const modelId = await loadModel({
    modelSrc: WHISPER_MODEL,
    modelConfig: {
      language: 'en',
      translate: false,
      no_timestamps: false,
      temperature: 0.0,
      suppress_blank: true,
      contextParams: { use_gpu: true, flash_attn: true },
    },
    onProgress: (p: ModelProgressUpdate) => {
      process.stderr.write(`▸ Voice model ${p.percentage.toFixed(0)}%\r`)
    },
  })
  logEvidence({
    ts: new Date().toISOString(),
    op: 'model_load',
    model: 'WHISPER_TINY',
    modelId,
    totalMs: Date.now() - t0,
  })
  return modelId
}

export async function unloadVoiceModel(modelId: string) {
  const t0 = Date.now()
  await unloadModel({ modelId })
  logEvidence({
    ts: new Date().toISOString(),
    op: 'model_unload',
    model: 'WHISPER_TINY',
    modelId,
    totalMs: Date.now() - t0,
  })
}

/**
 * Transcribes a WAV file to text entirely on-device. Returns the joined
 * transcript and per-segment metadata for the auditable log.
 */
export async function transcribeAudio(
  modelId: string,
  wavPath: string,
): Promise<{ text: string; segments: Array<{ startMs: number; endMs: number; text: string }> }> {
  const t0 = Date.now()
  const segments = await transcribe({
    modelId,
    audioChunk: wavPath,
    metadata: true,
  })
  const text = segments.map((s) => s.text).join(' ').trim()
  logEvidence({
    ts: new Date().toISOString(),
    op: 'inference',
    model: 'WHISPER_TINY',
    modelId,
    prompt: wavPath,
    totalMs: Date.now() - t0,
  })
  return {
    text,
    segments: segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
  }
}