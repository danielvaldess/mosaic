#!/usr/bin/env node
/**
 * One-time conversion of the Philips dummy dataset (xlsx) to JSON.
 * Run only when the source workbook changes. Requires `xlsx` in a throwaway
 * environment — NOT in the production dependency tree (avoids GHSA-4r6h-8v6p-xvw6).
 *
 * Usage: node scripts/convert-xlsx.mjs <input.xlsx> <output.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: node scripts/convert-xlsx.mjs <input.xlsx> <output.json>')
  process.exit(1)
}
const wb = XLSX.read(readFileSync(input))
const ws = wb.Sheets['Dummy Installed Base']
if (!ws) throw new Error('Sheet "Dummy Installed Base" not found')
writeFileSync(output, JSON.stringify(XLSX.utils.sheet_to_json(ws), null, 2))
console.log(`✓ Converted ${input} -> ${output}`)