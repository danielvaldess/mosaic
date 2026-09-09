import 'tsx/esm'
/**
 * Voice capture demo: transcribes a WAV file entirely on-device using the
 * QVAC Whisper model, writes the transcript to a .txt file.
 *
 * Usage: node scripts/voice-capture.mjs <input.wav> [output.txt]
 * Requirements: WAV 16 kHz mono (convert with ffmpeg if needed).
 */
import { writeFileSync } from 'node:fs'

const wav = process.argv[2]


if (!wav) {
  console.error('Usage: node scripts/voice-capture.mjs <input.wav> [output.txt]')
  process.exit(1)
}

const out = process.argv[3] ?? wav.replace(/\.wav$/i, '.txt')
const { loadVoiceModel, transcribeAudio, unloadVoiceModel } = await import('../src/voice/transcribe.ts')
const { initEvidence } = await import('../src/evidence/logger.ts')
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
