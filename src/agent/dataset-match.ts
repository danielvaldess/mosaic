/**
 * Dataset matching for follow-up answers. Free-typed answers (brand, model,
 * hospital) are kept aligned with the installed-base vocabulary, tolerating
 * small typos while still surfacing the canonical values as suggestions.
 */

export interface DatasetMatch {
  status: 'exact' | 'close' | 'invalid'
  /** Present only for exact matches: the dataset spelling of the value. */
  canonical?: string
  /** Closest dataset values, best first. */
  suggestions: string[]
}

/** Folds case, accents and punctuation so "Panamá City!" === "panama city". */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1)
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution)
    }
    previous = current
  }
  return previous[b.length]!
}

function similarityScore(answer: string, candidate: string): number {
  if (answer === candidate) return 1
  const longest = Math.max(answer.length, candidate.length)
  const score = 1 - levenshtein(answer, candidate) / longest
  // A partial answer ("aurelia" for "Aurelia Health") is an abbreviation, not a
  // typo, so it scores above the close threshold even though edit distance is high.
  if (answer.length >= 3 && (candidate.startsWith(`${answer} `) || answer.startsWith(`${candidate} `))) {
    return Math.max(score, 0.9)
  }
  // All significant words of the answer appearing in the candidate ("DemoCare
  // Pacific" for "Hospital DemoCare Pacific") is the same kind of abbreviation.
  const tokens = answer.split(' ').filter(token => token.length >= 3)
  if (tokens.length && tokens.every(token => candidate.includes(token))) {
    return Math.max(score, 0.9)
  }
  return score
}

/**
 * Compares an answer against the dataset vocabulary.
 * Returns undefined when there is nothing to validate against (empty dataset),
 * so a fresh installation never blocks data entry.
 */
export function matchDataset(
  answer: string,
  candidates: readonly string[],
  options: { closeThreshold?: number; maxSuggestions?: number } = {},
): DatasetMatch | undefined {
  const normalized = normalizeForMatch(answer)
  if (!normalized) return undefined
  const values = [...new Set(candidates.map(c => c.trim()).filter(c => c && !/^unknown$/i.test(c)))]
  if (values.length === 0) return undefined
  for (const value of values) {
    if (normalizeForMatch(value) === normalized) return { status: 'exact', canonical: value, suggestions: [] }
  }
  const closeThreshold = options.closeThreshold ?? 0.72
  const maxSuggestions = options.maxSuggestions ?? 5
  const ranked = values
    .map(value => ({ value, score: similarityScore(normalized, normalizeForMatch(value)) }))
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
  const suggestions = ranked.slice(0, maxSuggestions).map(entry => entry.value)
  return { status: ranked[0]!.score >= closeThreshold ? 'close' : 'invalid', suggestions }
}
