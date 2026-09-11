import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { normalizeForMatch } from '../agent/dataset-match.js'

const rowSchema = z.object({
  'Customer / Hospital': z.string().min(1), City: z.string().min(1), Country: z.string().min(1),
  Modality: z.string().min(1), Quantity: z.number().int().positive(),
  'Dummy Brand': z.string().min(1), 'Dummy Model': z.string().min(1),
  'Approx. Age (Years)': z.number().int().nonnegative(),
})
export type CatalogRow = z.infer<typeof rowSchema>
// An immutable reference, independent of saved observations and database resets.
// Electron supplies its bundled resource path; web/CLI resolve from the project.
const source = process.env.MOSAIC_SEED_PATH ?? new URL('../../data/dummy_installed_base.json', import.meta.url)
export const installedBase: readonly Readonly<CatalogRow>[] = Object.freeze(
  z.array(rowSchema).min(1).parse(JSON.parse(readFileSync(source, 'utf8'))).map(row => Object.freeze(row)),
)

export const sameValue = (a: string, b: string) => normalizeForMatch(a) === normalizeForMatch(b)
export const uniqueValues = (rows: readonly Readonly<CatalogRow>[], key: keyof CatalogRow): string[] =>
  [...new Set(rows.map(row => String(row[key])))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

export function catalogSuggestions(modality?: string) {
  const rows = modality ? installedBase.filter(row => sameValue(row.Modality, modality)) : installedBase
  return {
    brands: uniqueValues(rows, 'Dummy Brand'), models: uniqueValues(rows, 'Dummy Model'),
    hospitals: uniqueValues(rows, 'Customer / Hospital'), cities: uniqueValues(rows, 'City'),
    countries: uniqueValues(rows, 'Country'), modalities: uniqueValues(rows, 'Modality'),
    quantities: uniqueValues(rows, 'Quantity'), ages: uniqueValues(rows, 'Approx. Age (Years)'),
  }
}
