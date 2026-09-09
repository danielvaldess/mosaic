import { afterEach, describe, expect, it, vi } from 'vitest'
import { Conversation, mergeExtraction } from '../src/agent/conversation.js'
import { openDb, allObservations, equipmentForObservation, findOrCreateCustomer } from '../src/store/db.js'
import { filterModalitiesMentioned, normalizeModality } from '../src/agent/agent.js'
import { parseExtraction } from '../src/extract/prompt.js'
import type { Extraction } from '../src/types.js'

const databases: ReturnType<typeof openDb>[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function setup(extraction: Extraction = { customer: { name: 'Test Hospital', city: 'Panama', country: 'Panama' }, equipment: [{ modality: 'MR', quantity: 2, brand: 'NovaMed' }] }) {
  const db = openDb(':memory:'); databases.push(db)
  const extract = vi.fn(async (_text: string) => structuredClone(extraction))
  return { db, extract, conversation: new Conversation(db, extract, 'tester') }
}

describe('review and save', () => {
  it('waits for confirmation and saves the exact draft once, without another inference', async () => {
    const {db, extract, conversation} = setup()
    const draft = await conversation.turn('Two MR systems')
    expect(allObservations(db)).toHaveLength(0)
    const saved = await conversation.turn('confirm')
    expect(saved.observation?.id).toBe(draft.observation?.id)
    expect(saved.observation?.status).toBe('Confirmed')
    expect(saved.observation?.reviewConfirmed).toBe(true)
    await conversation.turn('confirm')
    expect(allObservations(db)).toHaveLength(1)
    expect(extract).toHaveBeenCalledTimes(1)
  })
  it('accumulates answers and saves the most recently reviewed extraction', async () => {
    const {db, extract, conversation} = setup()
    await conversation.turn('Two MR systems')
    await conversation.turn('NovaMed', 'Which brand?')
    extract.mockResolvedValueOnce({ customer: { name: 'Test Hospital' }, equipment: [{ modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'Model 700', ageMin: 8 }] })
    await conversation.turn('Model 700, eight years old', 'Which model and age?')
    expect(extract.mock.calls[2]?.[0]).toContain('Answer: NovaMed')
    const saved = await conversation.turn('confirm')
    const equipment = equipmentForObservation(db, saved.observation!.id)
    expect(equipment[0]?.model).toBe('Model 700')
    expect(equipment[0]?.age?.min).toBe(8)
    expect(equipment[0]?.status).toBe('Estimated')
    expect(saved.observation?.reviewConfirmed).toBe(true)
  })
  it('retains the original equipment description while asking for customer details', async () => {
    const {extract, conversation} = setup()
    extract.mockResolvedValueOnce({ equipment: [{ modality: 'MR', quantity: 2 }] })
    await conversation.turn('Two MR systems')
    await conversation.turn('Test Hospital, Panama')
    expect(extract.mock.calls[1]?.[0]).toBe('Two MR systems\nTest Hospital, Panama')
  })
  it('retains the hospital when a later extraction omits it', async () => {
    const {conversation, extract} = setup({customer: {name: 'Test Hospital', city: 'Panama City', country: 'Panama'}, equipment: [{modality: 'MR'}]})
    await conversation.turn('MR systems at Test Hospital in Panama City, Panama')
    extract.mockResolvedValueOnce({equipment: [{modality: 'MR', quantity: 2}]})
    const reply = await conversation.turn('2', 'Do you know the quantity (MR)?')
    expect(reply.observation?.equipment[0]?.quantity).toBe(2)
    expect(reply.message).toContain('Test Hospital, Panama City, Panama')
  })
  it('does not ask for a hospital already present in the user text when the model omits it', async () => {
    const {conversation} = setup({equipment: [{modality: 'MR', quantity: 1}]})
    const reply = await conversation.turn("I'm at Hospital Test in Panama City, Panama. They have two MR systems.")
    expect(reply.observation?.equipment[0]?.quantity).toBe(2)
    expect(reply.message).toContain('Hospital Test, Panama City, Panama')
  })
  it('retains equipment when the next extraction only identifies the hospital', async () => {
    const {conversation, extract} = setup({equipment: [{modality: 'MR', quantity: 2}]})
    await conversation.turn('Two MR systems')
    extract.mockResolvedValueOnce({customer: {name: 'Test Hospital', city: 'Panama City', country: 'Panama'}, equipment: []})
    const reply = await conversation.turn('Test Hospital, Panama City, Panama')
    expect(reply.observation?.equipment[0]?.quantity).toBe(2)
  })
  it('applies follow-up answers directly and presents the remaining questions sequentially', async () => {
    const incomplete: Extraction = {customer: {name: 'Test Hospital', city: 'Panama', country: 'Panama'}, equipment: [{modality: 'MR', quantity: 2}]}
    const {conversation} = setup(incomplete)
    let reply = await conversation.turn('Two MR systems at Test Hospital in Panama, Panama')
    expect(reply.followUps.map(f => f.intent)).toEqual(['brand', 'model', 'age'])
    reply = await conversation.turn('NovaMed', reply.followUps[0]!.question)
    expect(reply.observation?.equipment[0]?.brand).toBe('NovaMed')
    expect(reply.followUps.map(f => f.intent)).toEqual(['model', 'age'])
    reply = await conversation.turn('NM-MR 700', reply.followUps[0]!.question)
    expect(reply.observation?.equipment[0]?.model).toBe('NM-MR 700')
    expect(reply.followUps.map(f => f.intent)).toEqual(['age'])
    reply = await conversation.turn('8 years', reply.followUps[0]!.question)
    expect(reply.observation?.equipment[0]?.age).toMatchObject({min: 8, max: 8})
    expect(reply.followUps).toEqual([])
  })
  it('requires a duplicate warning before overriding and resets after saving', async () => {
    const {db, conversation} = setup()
    await conversation.turn('Two MR systems'); await conversation.turn('confirm')
    await conversation.turn('Two MR systems')
    const blocked = await conversation.turn('save anyway')
    expect(blocked.duplicates?.length).toBeGreaterThan(0)
    expect(allObservations(db)).toHaveLength(1)
    const saved = await conversation.turn('save anyway')
    expect(saved.saved).toBe(true)
    await conversation.turn('save anyway')
    expect(allObservations(db)).toHaveLength(2)
  })
  it('discards the pending observation and its context', async () => {
    const {db, extract, conversation} = setup()
    await conversation.turn('Two MR systems'); await conversation.turn('skip'); await conversation.turn('confirm')
    expect(allObservations(db)).toHaveLength(0)
    await conversation.turn('One CT scanner')
    expect(extract.mock.calls[1]?.[0]).toBe('One CT scanner')
  })
  it('does not add failed requests to the conversation', async () => {
    const {extract, conversation} = setup()
    await conversation.turn('Two MR systems')
    extract.mockRejectedValueOnce(new Error('inference failed'))
    await expect(conversation.turn('failed answer')).rejects.toThrow('inference failed')
    await conversation.turn('retry answer')
    expect(extract.mock.calls[2]?.[0]).toBe('Two MR systems\nretry answer')
  })
  it('autosave does not claim explicit confirmation', async () => {
    const {db, extract} = setup()
    const reply = await new Conversation(db, extract, 'tester', true).turn('Two MR systems')
    expect(reply.saved).toBe(true)
    expect(reply.observation?.status).toBe('Reported')
    expect(reply.observation?.reviewConfirmed).toBe(false)
  })
})

describe('extraction memory', () => {
  it('keeps known fields and allows later concrete values to replace them', () => {
    const previous: Extraction = {customer: {name: 'Hospital', city: 'Panama'}, equipment: [{modality: 'MR', quantity: 2, brand: 'NovaMed'}]}
    const merged = mergeExtraction(previous, {customer: {name: 'Unknown', country: 'Panama'}, equipment: [{modality: 'MR', model: 'MR 700'}]})
    expect(merged.customer).toEqual({name: 'Hospital', city: 'Panama', country: 'Panama'})
    expect(merged.equipment[0]).toMatchObject({modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'MR 700'})
  })
})

describe('data validation', () => {
  it('does not interpret the letters ct inside a word as equipment', () => {
    expect(filterModalitiesMentioned('The doctor visited', {equipment: [{modality: 'CT'}]}).equipment).toEqual([])
    expect(normalizeModality('Image Guided Therapy')).toBe('Image Guided Therapy')
  })
  it('rejects invalid model output before it reaches storage', () => {
    for (const value of [null, {}, {equipment: null}, {equipment: [{quantity: -1}]}, {equipment: [{certainty: 'Certain'}]}, {equipment: [{ageMin: 8, ageMax: 2}]}]) {
      expect(() => parseExtraction(value)).toThrow()
    }
    expect(parseExtraction({equipment: [], missingFields: [{field: 'brand'}]}).equipment).toEqual([])
  })
  it('maps timestamps when returning an existing customer', () => {
    const {db} = setup()
    const input = {name: 'Hospital', city: 'Panama', country: 'Panama'}
    const first = findOrCreateCustomer(db, input)
    expect(findOrCreateCustomer(db, input).createdAt).toBe(first.createdAt)
  })
})
