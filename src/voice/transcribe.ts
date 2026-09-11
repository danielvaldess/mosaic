import {
  loadModel,
  transcribe,
  unloadModel,
  WHISPER_LARGE_V3_TURBO,
  type ModelProgressUpdate,
} from '@qvac/sdk'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logEvidence } from '../evidence/logger.js'

export const WHISPER_MODEL = WHISPER_LARGE_V3_TURBO

export async function loadVoiceModel() {
  const t0 = Date.now()
  const modelId = await loadModel({
    modelSrc: WHISPER_MODEL,
    modelConfig: {
      translate: false,
      no_timestamps: false,
      temperature: 0.0,
      suppress_blank: true,
      suppress_nst: true,
      n_threads: 8,
      contextParams: { use_gpu: true, flash_attn: true },
    },
    onProgress: (p: ModelProgressUpdate) => {
      process.stderr.write(`▸ Voice model ${p.percentage.toFixed(0)}%\r`)
    },
  })
  logEvidence({
    ts: new Date().toISOString(),
    op: 'model_load',
    model: 'WHISPER_LARGE_V3_TURBO',
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
    model: 'WHISPER_LARGE_V3_TURBO',
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
    model: 'WHISPER_LARGE_V3_TURBO',
    modelId,
    prompt: wavPath,
    totalMs: Date.now() - t0,
  })
  return {
    text,
    segments: segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
  }
}

/**
 * Transcribes an audio buffer (WAV from browser) entirely on-device.
 * Accepts a language hint ('es', 'en') to improve accuracy.
 */
export async function transcribeBuffer(
  modelId: string,
  audio: Buffer,
  lang?: string,
): Promise<{ text: string; segments: Array<{ startMs: number; endMs: number; text: string }> }> {
  const t0 = Date.now()
  const prompt = lang === 'es'
    ? '[Idioma: español] Observación de equipo médico en hospital. Hospital, resonador magnético, tomógrafo, ecógrafo, rayos X, equipo médico, instalado, mantenido, averiado, obsoleto.'
    : lang === 'en'
      ? '[Language: English] Medical equipment observation in hospital. MRI, CT scanner, ultrasound, X-ray, medical equipment, installed, maintained, damaged, obsolete.'
      : 'Medical equipment observation. Hospital. MRI. CT scanner. Ultrasound. X-ray.'
  const dir = mkdtempSync(join(tmpdir(), 'mosaic-voice-'))
  const wavPath = join(dir, 'recording.wav')
  writeFileSync(wavPath, audio)
  try {
    // The audio buffer overload is loosely typed; the file-path overload is the
    // documented one, so the browser WAV is staged on disk before transcribing.
    const segments = await transcribe({
      modelId,
      audioChunk: wavPath,
      prompt,
      metadata: true,
    })
    const text = segments.map((s) => s.text).join(' ').trim()
    logEvidence({
      ts: new Date().toISOString(),
      op: 'inference',
      model: 'WHISPER_LARGE_V3_TURBO',
      modelId,
      prompt: `[audio-buffer lang=${lang ?? 'auto'}]`,
      totalMs: Date.now() - t0,
    })
    return {
      text,
      segments: segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const HALLUCINATION_PATTERNS = [
  /^[\s.!?¿?!?,;:]+$/,
  /^(you|thank|thanks|subscribe|bye|hello|ok|okay|um|uh|ah|hm|so|well|the|a|i|it|he|she|we|my|your|his|her)\.?$/i,
  /^(gracias|suscribete|adiós|hola|vale|bueno|pues|este|eh|mmm|ajá|_ok|sí|no)\.?$/i,
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /suscribete/i,
  /like and subscribe/i,
]

function hasRepeatedSegments(segments: Array<{ text: string }>, threshold = 3): boolean {
  if (segments.length < threshold) return false
  const counts = new Map<string, number>()
  for (const s of segments) {
    const normalized = s.text.trim().toLowerCase()
    if (normalized.length < 3) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    if ((counts.get(normalized) ?? 0) >= threshold) return true
  }
  return false
}

/**
 * Checks if text contains characters from unexpected scripts (non-Latin).
 * Whisper hallucinations often produce Icelandic, Thai, Devanagari, etc.
 */
function hasUnexpectedScript(text: string, lang?: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (lang === 'es' || lang === 'en' || !lang) {
    // Icelandic: þ ð æ ö (unique chars not in Spanish/English)
    if (/[þð]/i.test(normalized)) return true
    // Thai script
    if (/[\u0E00-\u0E7F]/.test(text)) return true
    // Devanagari (Hindi)
    if (/[\u0900-\u097F]/.test(text)) return true
    // Arabic
    if (/[\u0600-\u06FF]/.test(text)) return true
    // Cyrillic (Russian, etc.)
    if (/[\u0400-\u04FF]/.test(text)) return true
    // Korean
    if (/[\uAC00-\uD7AF]/.test(text)) return true
    // Japanese (Hiragana/Katakana)
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return true
    // Chinese
    if (/[\u4E00-\u9FFF]/.test(text)) return true
  }
  return false
}

export function validateTranscription(
  text: string,
  segments: Array<{ startMs: number; endMs: number; text: string }>,
  lang?: string,
): { valid: boolean; reason?: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { valid: false, reason: 'empty' }
  if (trimmed.length < 3) return { valid: false, reason: 'too_short' }
  if (HALLUCINATION_PATTERNS.some((p) => p.test(trimmed))) return { valid: false, reason: 'hallucination' }
  if (hasRepeatedSegments(segments)) return { valid: false, reason: 'repeated' }
  if (hasUnexpectedScript(trimmed, lang)) return { valid: false, reason: 'wrong_language' }
  return { valid: true }
}
