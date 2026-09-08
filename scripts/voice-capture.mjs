#!/usr/bin/env node
/**
 * Voice capture demo: transcribes a WAV file entirely on-device using the
 * QVAC Whisper model, writes the transcript to a .txt file.
 *
 * Usage: node scripts/voice-capture.mjs <input.wav> [output.txt]
 * Requirements: WAV 16 kHz mono (convert with ffmpeg if needed).
 */
import { loadVoiceModel, transcribeAudio, unloadVoiceModel } from '../src/voice/transcribe.js'
import { writeFileSync } from 'node:fs'
import { initEvidence } from '../src/evidence/logger.js'

const wav = process.argv[2]
const out = process.argv[3] ?? wav.replace(/\.wav$/i, '.txt')

if (!wav) {
  console.error('Usage: node scripts/voice-capture.mjs <input.wav> [output.txt]')
  process.exit(1)
}

initEvidence()
try {
  const modelId = await loadVoiceModel()
  const { text, segments } = await transcribeAudio(modelId, wav)
  writeFileSync(out, text + '\n')
  console.log(`▸ Transcript (${segments.length} segments):\n  "${text}"`)
  console.log(`▸ Saved to ${out}`)
  await unloadVoiceModel(modelId)
} catch (e) {
  console.error('✖', e)
  process.exit(1)
}