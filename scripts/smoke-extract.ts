#!/usr/bin/env node
/**
 * Smoke test: validates the end-to-end local-AI extraction pipeline with a real
 * QVAC model on this machine. Uses the smallest LLM (Qwen3-0.6B) so it fits on
 * CPU/iGPU; the target GPU box can use QWEN3_4B_INST_Q4_K_M instead.
 *
 * Usage: node --import tsx scripts/smoke-extract.ts
 * Requires: Vulkan (or CPU fallback), ~400MB disk for the model download.
 */
import {
  loadModel,
  unloadModel,
  completion,
  QWEN3_600M_INST_Q4,
} from '@qvac/sdk'
import { logEvidence, initEvidence } from '../src/evidence/logger.js'
import { SYSTEM_PROMPT, EXTRACTION_SCHEMA } from '../src/extract/prompt.js'
import { filterModalitiesMentioned } from '../src/agent/agent.js'
import type { Extraction } from '../src/types.js'

const PROMPTS = [
  'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
  'At Hospital DemoCare Horizon I saw three MR systems. Two seem old and one looks much newer.',
  'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
]

async function run(prompt: string, modelId: string) {
  const t0 = Date.now()
  const result = completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    stream: false,
    responseFormat: {
      type: 'json_schema',
      json_schema: { name: 'observation_extraction', schema: EXTRACTION_SCHEMA },
    },
  })
  const final = await result.final
  logEvidence({
    ts: new Date().toISOString(),
    op: 'inference',
    model: 'QWEN3_600M_INST_Q4',
    modelId,
    prompt,
    promptTokens: final.stats?.promptTokens,
    outputTokens: final.stats?.generatedTokens,
    ttftMs: final.stats?.timeToFirstToken,
    tokensPerSec: final.stats?.tokensPerSecond,
    totalMs: Date.now() - t0,
    backendDevice: final.stats?.backendDevice,
  })
  return final.contentText.trim()
}

try {
  initEvidence()
  console.log('▸ Loading Qwen3-0.6B (local, on-device inference)...')
  const modelId = await loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelConfig: { ctx_size: 4096 },
    onProgress: (p) => {
      const mb = (n: number) => (n / 1e6).toFixed(1)
      process.stderr.write(`▸ ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)\r`)
    },
  })

  console.log(`▸ Model loaded: ${modelId}\n`)
  for (const [i, p] of PROMPTS.entries()) {
    console.log(`▸ --- Prompt ${i + 1} ---`)
    console.log(`  "${p}"`)
    const raw = await run(p, modelId)
    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Extraction
      console.log('  extracted:', JSON.stringify(parsed.equipment, null, 2))
      // Demonstrate the anti-hallucination guard against small-model output.
      const guarded = filterModalitiesMentioned(p, parsed)
      const before = parsed.equipment.length
      const after = guarded.equipment.length
      if (after < before) {
        console.log(`  ⚠ anti-hallucination: dropped ${before - after} invented row(s)`)
      }
      console.log('  kept:', JSON.stringify(guarded.equipment, null, 2))
    } catch {
      console.log('  raw:', raw.slice(0, 300))
    }
    console.log()
  }

  await unloadModel({ modelId })
  console.log('▸ Smoke test complete. Inference ran fully on-device.')
  process.exit(0)
} catch (error) {
  console.error('✖', error)
  process.exit(1)
}