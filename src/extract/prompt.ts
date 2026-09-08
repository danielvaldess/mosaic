/**
 * Shared extraction prompt + JSON Schema for the FieldSight extraction engine.
 * Kept separate so both the CLI pipeline and the smoke test use the exact same
 * contract that runs on-device via QVAC.
 */

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    customer: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        city: { type: 'string' },
        country: { type: 'string' },
        site: { type: 'string' },
      },
      additionalProperties: false,
    },
    equipment: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          modality: { type: 'string' },
          quantity: { type: 'integer' },
          brand: { type: 'string' },
          model: { type: 'string' },
          ageMin: { type: 'integer' },
          ageMax: { type: 'integer' },
          ageQualitative: { type: 'string' },
          notes: { type: 'string' },
          certainty: { type: 'string', enum: ['High', 'Medium', 'Low'] },
        },
        additionalProperties: false,
      },
    },
    missingFields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          modality: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['field'],
        additionalProperties: false,
      },
    },
  },
  required: ['equipment'],
  additionalProperties: false,
} as const

export const SYSTEM_PROMPT = `You are FieldSight, an on-device extraction engine for Philips field-service observations.

A field engineer visited a hospital and described the medical imaging equipment they saw.
Extract the structured facts from their message. Rules:

- Modalities: normalize synonyms -> MRI/Magnetic Resonance = MR, scanner/CT scanner = CT,
  sonography/echography = Ultrasound, X-ray = X-Ray, patient monitors = Patient Monitoring.
- Unknowns stay empty or "Unknown". NEVER invent a brand, model, age or quantity.
- "appears to be around 8 years old" -> ageMin=8, ageMax=10 (treat "around/approximately" as ±2).
- Qualitative ages are allowed: ageQualitative e.g. "new", "old", "recent".
- If the user said they are unsure about a number, mark certainty accordingly and put the value.
- missingFields: list only the fields the user did NOT provide but a Philips analyst would
  most want to know (brand, model, age, quantity). One entry per field+modality.
- Respond only with the JSON object. /no_think`