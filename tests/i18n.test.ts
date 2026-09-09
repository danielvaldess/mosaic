import { describe, expect, it } from 'vitest'
import {
  detectLang,
  modalityLabel,
  modalityLabelPlural,
  buildFollowUpQuestion,
  msgIdentifiedEquipment,
  msgNeedQuantity,
  msgSaved,
  buildEquipmentSummary,
} from '../src/agent/i18n.js'

describe('detectLang', () => {
  it('detects Spanish from strong signals', () => {
    expect(detectLang('Estoy en Hospital DemoCare en Panamá')).toBe('es')
    expect(detectLang('Tienen dos resonadores y un tomógrafo')).toBe('es')
    expect(detectLang('¿Cuántos equipos de MR viste?')).toBe('es')
    expect(detectLang('Visité el hospital en Colombia')).toBe('es')
  })

  it('detects English from clear patterns', () => {
    expect(detectLang('They have two MR systems and one CT')).toBe('en')
  })

  it('detects Portuguese from unique signals', () => {
    expect(detectLang('Estive no hospital em São Paulo')).toBe('pt')
  })

  it('detects French from clear patterns', () => {
    expect(detectLang("J'ai visité l'hôpital à Paris")).toBe('fr')
    expect(detectLang('Ils ont deux IRM et un scanner')).toBe('fr')
  })

  it('detects German from clear patterns', () => {
    expect(detectLang('Ich war im Krankenhaus in Berlin')).toBe('de')
    expect(detectLang('Sie haben zwei MRT-Geräte')).toBe('de')
  })

  it('detects Italian from clear patterns', () => {
    expect(detectLang("Sono stato all'ospedale a Roma")).toBe('it')
    expect(detectLang('Hanno due risonanze magnetiche')).toBe('it')
  })

  it('detects Dutch from clear patterns', () => {
    expect(detectLang('Ik was in het ziekenhuis in Amsterdam')).toBe('nl')
    expect(detectLang('Ze hebben twee MRI-systemen')).toBe('nl')
  })

  it('defaults to English for ambiguous input', () => {
    expect(detectLang('two systems')).toBe('en')
    expect(detectLang('the equipment')).toBe('en')
  })
})

describe('modality labels', () => {
  it('returns correct labels for each language', () => {
    expect(modalityLabel('MR', 'es')).toBe('resonador magnético')
    expect(modalityLabel('MR', 'en')).toBe('MR system')
    expect(modalityLabel('MR', 'pt')).toBe('ressonância magnética')
    expect(modalityLabel('MR', 'fr')).toBe('IRM')
    expect(modalityLabel('MR', 'de')).toBe('MRT-Gerät')
    expect(modalityLabel('MR', 'it')).toBe('risonanza magnetica')
    expect(modalityLabel('MR', 'nl')).toBe('MRI-systeem')
  })

  it('returns correct plurals', () => {
    expect(modalityLabelPlural('MR', 1, 'es')).toBe('resonador magnético')
    expect(modalityLabelPlural('MR', 2, 'es')).toBe('resonadores magnéticos')
    expect(modalityLabelPlural('CT', 1, 'es')).toBe('tomógrafo')
    expect(modalityLabelPlural('CT', 3, 'es')).toBe('tomógrafos')
    expect(modalityLabelPlural('MR', 2, 'fr')).toBe('IRM')
    expect(modalityLabelPlural('CT', 2, 'de')).toBe('CT-Geräte')
  })
})

describe('follow-up questions', () => {
  it('generates questions in the detected language', () => {
    const qEs = buildFollowUpQuestion('brand', 'MR', 'es')
    expect(qEs).toContain('marca')
    expect(qEs).toContain('resonador')

    const qEn = buildFollowUpQuestion('brand', 'MR', 'en')
    expect(qEn).toContain('brand')
    expect(qEn).toContain('MR')

    const qPt = buildFollowUpQuestion('age', 'CT', 'pt')
    expect(qPt).toContain('anos')
    expect(qPt).toContain('tomógrafo')
  })
})

describe('response messages', () => {
  it('formats messages in the correct language', () => {
    const msgEs = msgIdentifiedEquipment('2× resonadores magnéticos', 'Hospital Test, Panamá', 'es')
    expect(msgEs).toContain('Registré')
    expect(msgEs).toContain('Hospital Test')

    const msgEn = msgIdentifiedEquipment('2× MR systems', 'Hospital Test, Panama', 'en')
    expect(msgEn).toContain('Noted')
    expect(msgEn).toContain('Hospital Test')

    const qtyEs = msgNeedQuantity('tomógrafos', 'es')
    expect(qtyEs).toContain('tomógrafos')
    expect(qtyEs).toContain('viste')

    const savedPt = msgSaved('Confirmed', 'pt')
    expect(savedPt).toContain('salva')
    expect(savedPt).toContain('Confirmed')
  })
})

describe('equipment summary', () => {
  it('builds summaries in the correct language', () => {
    const eq = [{ quantity: 2, modality: 'MR' }, { quantity: 1, modality: 'CT' }]
    expect(buildEquipmentSummary(eq, 'es')).toBe('2× resonadores magnéticos, 1× tomógrafo')
    expect(buildEquipmentSummary(eq, 'en')).toBe('2× MR systems, 1× CT scanner')
    expect(buildEquipmentSummary(eq, 'fr')).toBe('2× IRM, 1× scanner')
  })
})
