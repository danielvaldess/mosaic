import { afterEach, expect, it } from 'vitest'
import { groundExtraction, handleObservation, planFollowUps, buildObservation } from '../src/agent/agent.js'
import { Conversation } from '../src/agent/conversation.js'
import { openDb, findOrCreateCustomer, allObservations } from '../src/store/db.js'
import type { Extraction } from '../src/types.js'

const databases: ReturnType<typeof openDb>[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
const hospital = {name: 'Hospital Test', city: 'Panama City', country: 'Panama'}
function setup() { const db = openDb(':memory:'); databases.push(db); return {db, customer: findOrCreateCustomer(db, hospital)} }
function wrongOutput(quantity?: number): Extraction { return {customer: hospital, equipment: [{modality: 'MR', quantity, model: 'MR'}]} }

it.each([1, undefined])('fixes the screenshot scenario with a wrong or absent count (%s)', quantity => {
  const {db, customer} = setup()
  const reply = handleObservation({db, customer, observer: 'tester', observedAt: '2026-09-09', source: 'Text',
    rawInput: "I'm at Hospital Test in Panama City, Panama. They have two MR systems.", extraction: wrongOutput(quantity)})
  expect(reply.observation?.equipment[0]?.quantity).toBe(2)
  expect(reply.observation?.equipment[0]?.model).toBe('Unknown')
  expect(reply.followUps.map(f => f.intent)).toEqual(['brand', 'model', 'age'])
  expect(allObservations(db)).toHaveLength(0)
})

it('grounds the hospital and location from the screenshot text', () => {
  const grounded = groundExtraction("I'm at Hospital Test in Panama City, Panama. They have two MR systems.", wrongOutput(1))
  expect(grounded.customer).toEqual({name: 'Hospital Test', city: 'Panama City', country: 'Panama'})
})

it.each([
  ['Hospital Test, Panama City, Panama', {name: 'Hospital Test', city: 'Panama City', country: 'Panama'}],
  ['Hospital Test in Panama City, Panama', {name: 'Hospital Test', city: 'Panama City', country: 'Panama'}],
  ['Estoy en Hospital Central en Ciudad de México, México.', {name: 'Hospital Central', city: 'Ciudad de México', country: 'México'}],
])('grounds a hospital supplied as a direct reply: %s', (text, expected) => {
  expect(groundExtraction(text as string, {equipment: []}).customer).toEqual(expected)
})

it('associates adjacent English and Spanish counts with their own modality', () => {
  const extraction: Extraction = {equipment: [{modality: 'MR', quantity: 1}, {modality: 'CT', quantity: 1}]}
  expect(groundExtraction('two MR systems and three CT scanners, eight years old', extraction).equipment.map(e => e.quantity)).toEqual([2, 3])
  expect(groundExtraction('dos MR y tres CT', extraction).equipment.map(e => e.quantity)).toEqual([2, 3])
})

it('does not apply a modality total to each product model', () => {
  const extraction: Extraction = {equipment: [{modality: 'MR', model: 'Ingenia', quantity: 1}, {modality: 'MR', model: 'Achieva', quantity: 1}]}
  expect(groundExtraction('two MR systems: one Ingenia and one Achieva', extraction).equipment.map(e => e.quantity)).toEqual([1, 1])
})

it.each(['MR is 2 years old', '3T MR scanner', 'two or three MR', 'at least two MR', 'not two MR', 'two MR and one MR', '2-3 MR', '1.5 MR', 'model 700 MR'])('does not force a count from ambiguous or unrelated numbers: %s', text => {
  expect(groundExtraction(text, wrongOutput()).equipment[0]?.quantity).toBeUndefined()
})

it('preserves later quantity corrections across subsequent brand answers', () => {
  const text = 'two MR systems\nFollow-up: Do you know the quantity (MR)?\nAnswer: 3'
  expect(groundExtraction(text, wrongOutput(2)).equipment[0]?.quantity).toBe(3)
  expect(groundExtraction(text + '\nFollow-up: Do you know the brand (MR)?\nAnswer: NovaMed', wrongOutput(2)).equipment[0]?.quantity).toBe(3)
  expect(groundExtraction('two MR\nActually there are three', wrongOutput(3)).equipment[0]?.quantity).toBe(3)
  expect(groundExtraction('two MR\nFollow-up: Do you know the quantity (MR)?\nAnswer: Three in total', wrongOutput(3)).equipment[0]?.quantity).toBe(3)
  expect(groundExtraction(text + '\nFollow-up: Do you know the quantity (MR)?\nAnswer: Four in total', wrongOutput(4)).equipment[0]?.quantity).toBe(4)
})

it('does not read the last token of a compound count as the entire quantity', () => {
  expect(groundExtraction('twenty two MR', wrongOutput(22)).equipment[0]?.quantity).toBe(22)
  expect(groundExtraction('twenty-two MR', wrongOutput(22)).equipment[0]?.quantity).toBe(22)
  expect(groundExtraction('1,234 MR', wrongOutput(1234)).equipment[0]?.quantity).toBe(1234)
})

it('restores the stated quantity if an unrelated followup makes the model lose it', () => {
  expect(groundExtraction('two MR\nFollow-up: Do you know the model (MR)?\nAnswer: MR 700', wrongOutput(1)).equipment[0]?.quantity).toBe(2)
})

it('cleans only bare modality aliases from product models', () => {
  for (const model of ['MR 700', 'Magnetom MR', 'CT Revolution']) {
    expect(groundExtraction('two MR', {equipment: [{modality: 'MR', model}]}).equipment[0]?.model).toBe(model)
  }
})

it('asks for a missing count before autosave or confirmation', async () => {
  const {db, customer} = setup()
  const extraction: Extraction = {customer: hospital, equipment: [{modality: 'MR'}]}
  const conversation = new Conversation(db, async () => extraction, 'tester', true)
  const reply = await conversation.turn('They have MR systems')
  expect(reply.observation).toBeUndefined()
  expect(reply.followUps[0]?.intent).toBe('quantity')
  expect((await conversation.turn('confirm')).saved).not.toBe(true)
  expect(allObservations(db)).toHaveLength(0)
  expect(() => buildObservation({extraction, customer, rawInput: 'MR', observer: 'tester', observedAt: '2026-09-09', source: 'Text'})).toThrow('Quantity required')
})

it('ignores stale missingFields and treats zero years as a known age', () => {
  const followUps = planFollowUps({equipment: [{modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'MR 700', ageMin: 0}],
    missingFields: [{field: 'quantity', modality: 'MR'}, {field: 'brand', modality: 'MR'}, {field: 'model', modality: 'MR'}, {field: 'age', modality: 'MR'}]})
  expect(followUps).toEqual([])
})

it('does not ask for a modality that is already present', () => {
  const followUps = planFollowUps({equipment: [{modality: 'MR', quantity: 2}],
    missingFields: [{field: 'modality', modality: 'MR'}, {field: 'quantity', modality: 'MR'}]})
  expect(followUps.every(f => f.question !== 'Do you know the modality (MR)? ')).toBe(true)
  expect(followUps.map(f => f.intent)).toEqual(['brand', 'model', 'age'])
})
