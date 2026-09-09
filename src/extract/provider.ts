import type { Extraction } from '../types.js'
import { extractObservation, loadExtractionModel, unloadExtractionModel } from './extractor.js'
import { extractRemote, remoteConfigFromEnv } from './remote.js'

export type ExtractFn = (text: string) => Promise<Extraction>

export interface InferenceHandle {
  extract: ExtractFn
  mode: 'local' | 'remote'
  backend: string
  dispose: () => Promise<void>
}

/**
 * Unified inference entrypoint. Chooses the backend automatically:
 *  - FIELDSIGHT_LLM_URL set  → delegate to a peer's QVAC HTTP server (GPU).
 *  - otherwise               → load the local QVAC model on this machine.
 *
 * Both paths return the same ExtractFn consumed by Conversation, so the
 * conversational agent works identically over local or delegated inference.
 */
export async function createInference(): Promise<InferenceHandle> {
  const remote = remoteConfigFromEnv()
  if (remote) {
    console.log(`▸ Delegating inference → ${remote.baseUrl} (model: ${remote.model})`)
    return {
      extract: (text: string) => extractRemote(remote!, text),
      mode: 'remote',
      backend: remote.baseUrl,
      dispose: async () => {},
    }
  }
  console.log('▸ Loading local QVAC model…')
  const modelId = await loadExtractionModel()
  return {
    extract: async (text: string) => (await extractObservation(text, modelId)).extraction,
    mode: 'local',
    backend: 'local',
    dispose: () => unloadExtractionModel(modelId),
  }
}