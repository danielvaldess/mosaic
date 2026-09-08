import Database from 'better-sqlite3'
import {
  allObservations,
  equipmentForObservation,
  findOrCreateCustomer,
  insertObservation,
} from '../store/db.js'
import type {
  Confidence,
  Customer,
  EquipmentObservation,
  Extraction,
  FollowUp,
  Observation,
  Status,
} from '../types.js'

export interface AgentReply {
  message: string
  followUps: FollowUp[]
  observation?: Observation
  saved?: boolean
  duplicates?: DuplicateHit[]
}

export interface DuplicateHit {
  existingObservationId: string
  customerId: string
  modality: string
  score: number
  reason: string
}

const MODALITY_SYNONYMS: Record<string, string> = {
  mr: 'MR',
  mri: 'MR',
  'magnetic resonance': 'MR',
  'magnetic resonance imaging': 'MR',
  resonance: 'MR',
  scanner: 'CT',
  'ct scanner': 'CT',
  ct: 'CT',
  ultrasound: 'Ultrasound',
  'ultra sound': 'Ultrasound',
  sonography: 'Ultrasound',
  sonographer: 'Ultrasound',
  echo: 'Ultrasound',
  xray: 'X-Ray',
  'x-ray': 'X-Ray',
  'patient monitor': 'Patient Monitoring',
  monitoring: 'Patient Monitoring',
}

export function normalizeModality(raw?: string): string | undefined {
  if (!raw) return undefined
  const key = raw.toLowerCase().trim()
  if (MODALITY_SYNONYMS[key]) return MODALITY_SYNONYMS[key]
  // Handle composite outputs like "MRI/Magnetic Resonance" or "CT scanner (2)".
  for (const sep of ['/', ',', '(', ';']) {
    const first = key.split(sep)[0]?.trim()
    if (first && MODALITY_SYNONYMS[first]) return MODALITY_SYNONYMS[first]
  }
  // Fuzzy containment: pick the first known modality present in the string.
  for (const [alias, canonical] of Object.entries(MODALITY_SYNONYMS)) {
    if (key.includes(alias)) return canonical
  }
  return undefined
}

/** All aliases that resolve to a given canonical modality. */
function aliasesFor(canonical: string): string[] {
  return Object.entries(MODALITY_SYNONYMS)
    .filter(([, c]) => c === canonical)
    .map(([alias]) => alias)
}

/**
 * Anti-hallucination guard: a modality is kept only if the user's raw input
 * actually mentions it (via any synonym). Small local models sometimes invent
 * equipment that was never observed (e.g. adding an X-Ray to a report that
 * only mentioned MR + CT). True positives survive; invented rows are dropped.
 */
export function filterModalitiesMentioned(rawInput: string, extraction: Extraction): Extraction {
  const q = rawInput.toLowerCase()
  const mentioned = new Set<string>()
  for (const [alias, canonical] of Object.entries(MODALITY_SYNONYMS)) {
    if (q.includes(alias)) mentioned.add(canonical)
  }
  const kept = extraction.equipment.filter((e) => {
    const canonical = normalizeModality(e.modality)
    if (!canonical) return false
    // Trust explicitly-named modalities even without exact synonym match, and
    // keep rows whose modality is directly present in the input.
    return mentioned.has(canonical) || q.includes(canonical.toLowerCase())
  })
  return { ...extraction, equipment: kept }
}

/**
 * Converts the LLM Extraction into Observation rows, assigning per-equipment
 * Status/Confidence. Rules (from the brief's validation logic):
 *  - quantity provided → Report based; confidence reflects stated certainty
 *  - age qualitative → Estimated; unknown brand → Unknown
 *  - Confirmed only when the user explicitly confirms in the review step
 */
export function buildObservation(params: {
  extraction: Extraction
  customer: Customer
  observer: string
  observedAt: string
  rawInput: string
  source: Observation['source']
  statusOverride?: Status
}): Observation {
  const { extraction, customer, observer, observedAt, rawInput, source } = params
  const obsId = crypto.randomUUID()
  const equipment: EquipmentObservation[] = extraction.equipment
    .map((e, i) => {
      const modality = normalizeModality(e.modality)
      // Drop hallucinated/unrecognized modalities instead of persisting garbage.
      if (!modality) return null
      const certainty = e.certainty ?? 'Medium'
      const ageKnown = e.ageMin !== undefined || e.ageMax !== undefined || !!e.ageQualitative
      let status: Status = 'Reported'
      if (ageKnown) status = 'Estimated'
      if (params.statusOverride) status = params.statusOverride
      return {
        id: `${obsId}-EQ${i}`,
        observationId: obsId,
        customerId: customer.id,
        modality: modality as EquipmentObservation['modality'],
        quantity: e.quantity ?? 1,
        brand: (e.brand ?? 'Unknown') as EquipmentObservation['brand'],
        model: (e.model ?? 'Unknown') as EquipmentObservation['model'],
        age: e.ageMin !== undefined || e.ageMax !== undefined || e.ageQualitative
          ? {
              min: e.ageMin,
              max: e.ageMax,
              qualitative: e.ageQualitative,
              installationYear:
                e.ageMin !== undefined
                  ? new Date(observedAt).getFullYear() - e.ageMin
                  : undefined,
            }
          : undefined,
        status,
        confidence: (certainty ?? 'Medium') as Confidence,
        notes: e.notes,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const observation: Observation = {
    id: obsId,
    observer,
    observedAt,
    rawInput,
    source,
    customerId: customer.id,
    equipment,
    overallConfidence: overallConfidence(equipment),
    status: params.statusOverride ?? (equipment.some((e) => e.status === 'Estimated') ? 'Estimated' : 'Reported'),
    reviewConfirmed: false,
    createdAt: new Date().toISOString(),
  }
  return observation
}

function overallConfidence(eq: EquipmentObservation[]): Confidence {
  const scores = { High: 3, Medium: 2, Low: 1 }
  const avg = eq.reduce((s, e) => s + scores[e.confidence], 0) / Math.max(eq.length, 1)
  if (avg >= 2.5) return 'High'
  if (avg >= 1.5) return 'Medium'
  return 'Low'
}

/**
 * Detects duplicates: same customer + modality + similar brand/age within a
 * sliding window. Returns candidates above a fuzzy threshold.
 */
export function detectDuplicates(
  db: Database.Database,
  observation: Observation,
): DuplicateHit[] {
  const existing = allObservations(db).filter((o) => o.id !== observation.id)
  const hits: DuplicateHit[] = []
  for (const ex of existing) {
    const exEquipment = equipmentForObservation(db, ex.id)
    for (const exEq of exEquipment) {
      for (const newEq of observation.equipment) {
        if (normalizeModality(exEq.modality) !== normalizeModality(newEq.modality)) continue
        if (ex.customerId !== observation.customerId) continue

        let score = 0.5
        const reasons: string[] = []
        if (exEq.brand && newEq.brand && exEq.brand === newEq.brand) {
          score += 0.25
          reasons.push('same brand')
        }
        if (exEq.model && newEq.model && exEq.model === newEq.model) {
          score += 0.15
          reasons.push('same model')
        }
        if (exEq.age?.min !== undefined && newEq.age?.min !== undefined) {
          const diff = Math.abs(exEq.age.min - newEq.age.min)
          if (diff <= 1) {
            score += 0.1
            reasons.push('similar age')
          }
        }
        if (ex.observedAt) {
          const days = (Date.parse(observation.observedAt) - Date.parse(ex.observedAt)) / 86400000
          if (days >= 0 && days <= 90) {
            score += 0.1
            reasons.push(`recent (${Math.round(days)}d apart)`)
          }
        }
        if (score >= 0.75) {
          hits.push({
            existingObservationId: ex.id,
            customerId: ex.customerId,
            modality: exEq.modality,
            score,
            reason: reasons.join(', '),
          })
        }
      }
    }
  }
  return hits
}

/** Builds the follow-up questions for the most valuable missing data. */
export function planFollowUps(
  extraction: Extraction,
  max = 3,
): FollowUp[] {
  const ups: FollowUp[] = []
  const missing = extraction.missingFields ?? []
  for (const mf of missing) {
    if (ups.length >= max) break
    const mod = mf.modality ? ` (${normalizeModality(mf.modality) ?? mf.modality})` : ''
    const field = mf.field.toLowerCase()
    let intent: FollowUp['intent'] = 'notes'
    if (field.includes('brand') || field.includes('manufacturer')) intent = 'brand'
    else if (field.includes('model')) intent = 'model'
    else if (field.includes('age') || field.includes('old')) intent = 'age'
    else if (field.includes('quant')) intent = 'quantity'
    else if (field.includes('customer') || field.includes('hospital')) intent = 'customer'
    else if (field.includes('city') || field.includes('country')) intent = 'location'
    ups.push({
      question: `Do you know the ${mf.field}${mod}? ${mf.reason ? `(${mf.reason})` : ''}`,
      intent,
      modality: mf.modality,
    })
  }
  return ups
}

/**
 * Core agent turn: given the raw NL input, returns what to tell the user and
 * what to save. Saves immediately if all required fields present, else asks.
 */
export function handleObservation(params: {
  db: Database.Database
  extraction: Extraction
  customer: Customer
  observer: string
  observedAt: string
  rawInput: string
  source: Observation['source']
  autoSave?: boolean
}): AgentReply {
  const { db, extraction: rawExtraction, customer, observer, observedAt, rawInput, source } = params
  // Anti-hallucination: keep only equipment the user actually mentioned.
  const extraction = filterModalitiesMentioned(rawInput, rawExtraction)
  const observation = buildObservation({
    extraction,
    customer,
    observer,
    observedAt,
    rawInput,
    source,
  })

  const followUps = planFollowUps(extraction)
  const missingRequired = extraction.equipment.length === 0
  const hasModality = extraction.equipment.some((e) => e.modality)

  if (missingRequired || !hasModality || (followUps.length > 0 && !params.autoSave)) {
    let message = ''
    if (missingRequired) {
      message = 'I could not identify any medical equipment in that message. Which modality did you observe?'
    } else if (!params.autoSave) {
      const summary = observation.equipment
        .map((e) => `${e.quantity}× ${e.modality}`)
        .join(', ')
      message = `Got it: ${summary} at ${customer.name}, ${customer.city}, ${customer.country}.`
      if (followUps.length) {
        message += ` I have a few questions to make this observation more valuable:`
      } else {
        message += ` Ready to save. Reply "confirm" to store it, or tell me more.`
      }
    } else {
      message = `Saved (${observation.status}) at ${customer.name}.`
    }
    return { message, followUps, observation }
  }

  const duplicates = detectDuplicates(db, observation)
  if (duplicates.length > 0) {
    const dupMsg = duplicates
      .map((d) => `${d.modality} @ ${customer.name} (${Math.round(d.score * 100)}% match: ${d.reason})`)
      .join('; ')
    return {
      message: `⚠ Possible duplicates detected: ${dupMsg}. Reply "save anyway" to store as a new observation, or "skip".`,
      followUps: [],
      observation,
      duplicates,
    }
  }

  insertObservation(db, observation)
  const summary = observation.equipment
    .map((e) => `${e.quantity}× ${e.modality}${e.brand !== 'Unknown' ? ` (${e.brand})` : ''}`)
    .join(', ')
  return {
    message: `✓ Saved ${observation.status} observation: ${summary} at ${customer.name}.`,
    observation,
    saved: true,
    followUps: [],
  }
}