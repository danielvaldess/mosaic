import { SYSTEM_PROMPT, EXTRACTION_SCHEMA } from './prompt.js'
import { logEvidence } from '../evidence/logger.js'
import type { Extraction } from '../types.js'

/**
 * Remote inference via QVAC's OpenAI-compatible HTTP server.
 *
 * When a peer machine with a GPU runs `qvac serve --openai` (see
 * config/qvac.serve.json), it exposes a local model as an OpenAI-compatible
 * API. Any device on the LAN (or Tailscale network) can then delegate
 * inference to that GPU — data stays between the team's own machines, never
 * reaching a third-party cloud. This is "delegated peer-to-peer" inference,
 * allowed by the Philips brief.
 *
 * Point FieldSight at the peer's server with:
 *   FIELDSIGHT_LLM_URL=http://<peer-ip>:11437/v1
 *   FIELDSIGHT_LLM_MODEL=fieldsight-llm   (the alias configured on the server)
 *   FIELDSIGHT_LLM_API_KEY=<key>          (required when the peer binds to the LAN)
 *
 * If FIELDSIGHT_LLM_URL is not set, FieldSight uses the local QVAC model.
 */

const OPENAI_TIMEOUT_MS = 120_000

export interface RemoteConfig {
  baseUrl: string
  model: string
  apiKey?: string
}

export function remoteConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RemoteConfig | undefined {
  const baseUrl = env.FIELDSIGHT_LLM_URL
  if (!baseUrl) return undefined
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (!/\/v1$/.test(trimmed)) {
    throw new Error(
      'FIELDSIGHT_LLM_URL must point at the OpenAI-compatible base, e.g. http://<peer-ip>:11437/v1',
    )
  }
  return {
    baseUrl: trimmed,
    model: env.FIELDSIGHT_LLM_MODEL ?? 'fieldsight-llm',
    apiKey: env.FIELDSIGHT_LLM_API_KEY,
  }
}

/** Extracts with the remote OpenAI-compatible endpoint (the peer's GPU). */
export async function extractRemote(
  config: RemoteConfig,
  rawInput: string,
): Promise<Extraction> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: rawInput },
        ],
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'observation_extraction', schema: EXTRACTION_SCHEMA },
        },
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let detail = text.slice(0, 300)
      try {
        const err = JSON.parse(text) as { error?: { message?: string } }
        if (err.error?.message) detail = err.error.message
      } catch { /* keep raw body */ }
      throw new Error(`Remote inference failed (${response.status}): ${detail}`)
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('Remote inference returned empty content')

    logEvidence({
      ts: new Date().toISOString(),
      op: 'inference',
      model: config.model,
      modelId: config.baseUrl,
      prompt: rawInput,
      promptTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      totalMs: Date.now() - start,
      backendDevice: 'remote',
    })

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`Remote model did not return JSON: ${content.slice(0, 200)}`)
    return JSON.parse(jsonMatch[0]) as Extraction
  } finally {
    clearTimeout(timer)
  }
}