import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { extractRemote, remoteConfigFromEnv, type RemoteConfig } from '../src/extract/remote.js'
import { EXTRACTION_SCHEMA } from '../src/extract/prompt.js'

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(resolve))
    server = undefined
  }
})

async function startMockServer(handler: (body: unknown, req: import('node:http').IncomingMessage) => { status?: number; body: unknown }): Promise<string> {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const { status = 200, body } = handler(JSON.parse(raw || '{}'), req)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}/v1`
}

describe('remoteConfigFromEnv', () => {
  it('returns undefined when MOSAIC_LLM_URL is not set', () => {
    expect(remoteConfigFromEnv({})).toBeUndefined()
  })

  it('reads baseUrl and model from env, normalizing trailing slash', () => {
    const cfg = remoteConfigFromEnv({ MOSAIC_LLM_URL: 'http://192.168.1.5:11434/v1/', MOSAIC_LLM_MODEL: 'mosaic-llm', MOSAIC_LLM_API_KEY: 'k' })
    expect(cfg).toEqual({ baseUrl: 'http://192.168.1.5:11434/v1', model: 'mosaic-llm', apiKey: 'k' })
  })

  it('defaults model to mosaic-llm', () => {
    const cfg = remoteConfigFromEnv({ MOSAIC_LLM_URL: 'http://x:11434/v1' })
    expect(cfg?.model).toBe('mosaic-llm')
  })

  it('rejects a URL that does not point at /v1', () => {
    expect(() => remoteConfigFromEnv({ MOSAIC_LLM_URL: 'http://192.168.1.5:11434' })).toThrow(/must point at the OpenAI-compatible base/)
  })
})

describe('extractRemote', () => {
  it('sends system prompt + user text + json_schema format and parses the response', async () => {
    const baseUrl = await startMockServer((body, req) => {
      expect(req.url?.split('?')[0]).toBe('/v1/chat/completions')
      expect(req.headers['content-type']).toBe('application/json')
      const b = body as {
        model: string; temperature: number
        messages: Array<{ role: string; content: string }>
        response_format: { type: string; json_schema: { name: string; schema: unknown } }
      }
      expect(b.model).toBe('mosaic-llm')
      expect(b.temperature).toBe(0)
      expect(b.response_format.type).toBe('json_schema')
      expect(b.response_format.json_schema.name).toBe('observation_extraction')
      expect(b.response_format.json_schema.schema).toEqual(EXTRACTION_SCHEMA)
      expect(b.messages[0]!.role).toBe('system')
      expect(b.messages[0]!.content).toContain('Mosaic')
      expect(b.messages[1]!.content).toBe('two MR systems')
      return {
        body: {
          choices: [{ message: { content: JSON.stringify({ customer: { name: 'Hospital X' }, equipment: [{ modality: 'MR', quantity: 2 }] }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      }
    })
    const cfg: RemoteConfig = { baseUrl, model: 'mosaic-llm' }
    const extraction = await extractRemote(cfg, 'two MR systems')
    expect(extraction.equipment).toEqual([{ modality: 'MR', quantity: 2 }])
    expect(extraction.customer?.name).toBe('Hospital X')
  })

  it('sends the Bearer api key when configured', async () => {
    const baseUrl = await startMockServer((_body, req) => {
      expect(req.headers.authorization).toBe('Bearer secret-key')
      return { body: { choices: [{ message: { content: '{"equipment":[]}' } }] } }
    })
    await extractRemote({ baseUrl, model: 'm', apiKey: 'secret-key' }, 'x')
  })

  it('throws on non-2xx response', async () => {
    const baseUrl = await startMockServer(() => ({ status: 500, body: { error: { message: 'boom' } } }))
    await expect(extractRemote({ baseUrl, model: 'm' }, 'x')).rejects.toThrow(/Remote inference failed \(500\): boom/)
  })

  it('throws when the model returns no parseable JSON', async () => {
    const baseUrl = await startMockServer(() => ({ body: { choices: [{ message: { content: 'sorry, no json' } }] } }))
    await expect(extractRemote({ baseUrl, model: 'm' }, 'x')).rejects.toThrow(/did not return JSON/)
  })
})