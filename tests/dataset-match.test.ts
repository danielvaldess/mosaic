import { describe, expect, it } from 'vitest'
import { levenshtein, matchDataset, normalizeForMatch } from '../src/agent/dataset-match.js'

describe('normalizeForMatch', () => {
  it('folds accents, case and punctuation', () => {
    expect(normalizeForMatch('  Panamá City! ')).toBe('panama city')
    expect(normalizeForMatch('NM-MR 700')).toBe('nm mr 700')
  })
})

describe('levenshtein', () => {
  it('measures single-character typos', () => {
    expect(levenshtein('siemens', 'siemens')).toBe(0)
    expect(levenshtein('siemmens', 'siemens')).toBe(1)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('matchDataset', () => {
  const brands = ['NovaMed', 'Aurelia Health', 'Orion Imaging']

  it('accepts exact matches ignoring case and accents and returns the canonical value', () => {
    expect(matchDataset('novamed', brands)).toEqual({ status: 'exact', canonical: 'NovaMed', suggestions: [] })
  })

  it('suggests the closest value for a small typo', () => {
    const match = matchDataset('Nobamed', brands)
    expect(match?.status).toBe('close')
    expect(match?.suggestions[0]).toBe('NovaMed')
  })

  it('treats clear partial answers as close matches', () => {
    const match = matchDataset('aurelia', brands)
    expect(match?.status).toBe('close')
    expect(match?.suggestions[0]).toBe('Aurelia Health')
  })

  it('flags unrelated values as invalid but still offers options', () => {
    const match = matchDataset('asdfgh', brands)
    expect(match?.status).toBe('invalid')
    expect(match?.suggestions.length).toBeGreaterThan(0)
  })

  it('skips validation when there is no dataset vocabulary', () => {
    expect(matchDataset('anything', [])).toBeUndefined()
    expect(matchDataset('anything', ['Unknown'])).toBeUndefined()
    expect(matchDataset('   ', brands)).toBeUndefined()
  })
})
