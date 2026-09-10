import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EvidenceEntry } from '../types.js'

const EVIDENCE_DIR = process.env.MOSAIC_EVIDENCE_DIR ?? join(process.cwd(), 'evidence')
const LOG_PATH = join(EVIDENCE_DIR, 'evidence.jsonl')

export function initEvidence(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, '')
}

export function logEvidence(entry: EvidenceEntry): void {
  initEvidence()
  appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n')
}

export function readEvidence(): EvidenceEntry[] {
  if (!existsSync(LOG_PATH)) return []
  return readFileSync(LOG_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvidenceEntry)
}

/** Summarize inference performance for the auditable log (CSV companion). */
export function exportEvidenceCsv(): string {
  const rows = readEvidence()
  const header =
    'ts,op,model,promptTokens,outputTokens,ttftMs,tokensPerSec,totalMs,backendDevice'
  const lines = rows.map((e) =>
    [
      e.ts,
      e.op,
      e.model,
      e.promptTokens ?? '',
      e.outputTokens ?? '',
      e.ttftMs ?? '',
      e.tokensPerSec ?? '',
      e.totalMs ?? '',
      e.backendDevice ?? '',
    ].join(','),
  )
  return [header, ...lines].join('\n')
}