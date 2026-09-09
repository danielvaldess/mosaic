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
          quantity: { type: 'integer', minimum: 1 },
          brand: { type: 'string' },
          model: { type: 'string' },
          ageMin: { type: 'integer', minimum: 0 },
          ageMax: { type: 'integer', minimum: 0 },
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

type Schema = { type: string; properties?: Record<string, Schema>; required?: readonly string[];
  items?: Schema; enum?: readonly string[]; minimum?: number; additionalProperties?: boolean }

/** Validate against the same schema sent to QVAC; TypeScript casts do not validate model output. */
export function parseExtraction(value: unknown): import('../types.js').Extraction {
  function validate(value: unknown, schema: Schema, path: string): void {
    const fail = () => { throw new Error(`Invalid extraction at ${path}`) }
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) if (!(key in record)) fail()
      for (const [key, item] of Object.entries(record)) {
        const child = schema.properties?.[key]
        if (!child) { if (schema.additionalProperties === false) fail() }
        else validate(item, child, `${path}.${key}`)
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) return fail()
      value.forEach((item, i) => validate(item, schema.items!, `${path}[${i}]`))
    } else if (schema.type === 'string') {
      if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) fail()
    } else if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity)) fail()
    }
  }
  validate(value, EXTRACTION_SCHEMA, 'observation')
  const result = value as import('../types.js').Extraction
  for (const e of result.equipment) {
    if (e.ageMin !== undefined && e.ageMax !== undefined && e.ageMin > e.ageMax) throw new Error('Invalid age range')
  }
  return result
}

export const SYSTEM_PROMPT = `You are FieldSight, an on-device extraction engine for Philips field-service observations.

A field engineer visited a hospital and described the medical imaging equipment they saw.
Extract the structured facts from their message. Rules:

- IMPORTANT: Always extract the customer/hospital name, city, and country if mentioned. Look for patterns like:
  "I'm at [Hospital Name] in [City], [Country]"
  "Hospital [Name], [City]"
  "[Name] clinic in [City]"
  The customer.name field MUST be populated when the user mentions a hospital/clinic name.
- Modalities: normalize synonyms -> MRI/Magnetic Resonance = MR, scanner/CT scanner = CT,
  sonography/echography = Ultrasound, X-ray = X-Ray, patient monitors = Patient Monitoring.
  Spanish: resonador magnético/resonancia magnética = MR, tomógrafo = CT, ecógrafo = Ultrasound.
  Portuguese: ressonância magnética = MR, tomógrafo = CT, ecógrafo = Ultrasound.
  French: IRM = MR, scanner = CT, échographe = Ultrasound.
  German: MRT = MR, CT-Gerät = CT, Ultraschallgerät = Ultrasound.
  Italian: risonanza magnetica = MR, tomografo = CT, ecografo = Ultrasound.
  Dutch: MRI-systeem = MR, CT-scanner = CT, echograaf = Ultrasound.
- Unknowns stay empty or "Unknown". NEVER invent a brand, model, age or quantity.
- Preserve explicit counts: "two MR systems" means modality="MR", quantity=2; "one CT" means modality="CT", quantity=1.
- MR, MRI, CT and Ultrasound are modalities, not product models. If no product model is named, omit model.
- If no quantity is stated, omit quantity instead of assuming one. Never use an age, installation year or model number as the quantity.
- "appears to be around 8 years old" -> ageMin=8, ageMax=10 (treat "around/approximately" as ±2).
- Qualitative ages are allowed: ageQualitative e.g. "new", "old", "recent".
- If the user said they are unsure about a number, mark certainty accordingly and put the value.
- missingFields: list only the fields the user did NOT provide but a Philips analyst would
  most want to know (brand, model, age, quantity). One entry per field+modality.
- Respond only with the JSON object. /no_think`
