import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_DIR } from './store/db.js'

export type SettingsLanguage = 'en' | 'es'

export interface SettingsLocation {
  latitude?: number
  longitude?: number
  accuracy?: number
  city?: string
  country?: string
}

export interface AppSettings {
  onboardingComplete: boolean
  name?: string
  language?: SettingsLanguage
  location?: SettingsLocation
  updatedAt?: string
}

export const SETTINGS_PATH = join(DATA_DIR, 'settings.json')

const DEFAULT_SETTINGS: AppSettings = { onboardingComplete: false }

/** Reads the persisted first-run profile; corrupt files fall back to defaults. */
export function loadSettings(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const next = { ...settings, updatedAt: new Date().toISOString() }
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2))
  return next
}
