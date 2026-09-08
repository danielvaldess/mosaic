export const MODALITIES = [
  'MR',
  'CT',
  'Ultrasound',
  'X-Ray',
  'Patient Monitoring',
  'Image Guided Therapy',
] as const
export type Modality = (typeof MODALITIES)[number]

export const BRANDS = [
  'NovaMed',
  'Aurelia Health',
  'BluePeak Medical',
  'Orion Imaging',
  'HelixCare',
  'Zenith MedTech',
] as const
export type Brand = (typeof BRANDS)[number]

/** Trust level per field/observation, per the Philips brief. */
export const STATUSES = ['Confirmed', 'Reported', 'Estimated', 'Unknown'] as const
export type Status = (typeof STATUSES)[number]

export const CONFIDENCES = ['High', 'Medium', 'Low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export type Source = 'Voice' | 'Text' | 'Photo' | 'System'

/** An age value with optional range, e.g. { min: 5, max: 7 } or qualitative. */
export interface AgeEstimate {
  min?: number
  max?: number
  qualitative?: string
  /** Installation year when derivable from age + observation date. */
  installationYear?: number
}

export interface Customer {
  id: string
  name: string
  city: string
  country: string
  site?: string
  createdAt: string
}

export interface EquipmentObservation {
  id: string
  customerId: string
  observationId: string
  modality: Modality
  quantity: number
  brand?: Brand | 'Unknown'
  model?: string | 'Unknown'
  age?: AgeEstimate
  /** Per-equipment trust status. */
  status: Status
  confidence: Confidence
  notes?: string
}

export interface Observation {
  id: string
  observer: string
  observedAt: string
  rawInput: string
  source: Source
  customerId: string
  equipment: EquipmentObservation[]
  overallConfidence: Confidence
  status: Status
  /** Free-text captured in follow-up review. */
  reviewConfirmed?: boolean
  createdAt: string
}

/** Structured output contract the LLM must fill (tolerant of unknowns). */
export interface Extraction {
  customer?: {
    name?: string
    city?: string
    country?: string
    site?: string
  }
  equipment: Array<{
    modality?: string
    quantity?: number
    brand?: string
    model?: string
    ageMin?: number
    ageMax?: number
    ageQualitative?: string
    notes?: string
    certainty?: Confidence
  }>
  /** Facts the model thinks are missing and worth asking about. */
  missingFields?: Array<{
    field: string
    modality?: string
    reason: string
  }>
}

export interface FollowUp {
  question: string
  /** Machine-readable intent so the agent can merge the answer. */
  intent: 'brand' | 'model' | 'age' | 'quantity' | 'customer' | 'location' | 'notes'
  modality?: string
  observationIndex?: number
}

export interface EvidenceEntry {
  ts: string
  op: 'model_load' | 'model_unload' | 'inference'
  model: string
  modelId: string
  prompt?: string
  promptTokens?: number
  outputTokens?: number
  ttftMs?: number
  tokensPerSec?: number
  totalMs?: number
  backendDevice?: string
}