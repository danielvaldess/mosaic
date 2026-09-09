import { pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import Database from 'better-sqlite3'
import { openDb, allCustomers } from './store/db.js'
import { createInference } from './extract/provider.js'
import { Conversation } from './agent/conversation.js'
import { customer360, globalStats, queryInstalledBase } from './insights/insights.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface CliOptions {
  observer: string
  autoSave: boolean
  source: 'Voice' | 'Text'
}


async function handleCommand(line: string, db: Database.Database): Promise<boolean> {
  const [cmd, ...rest] = line.split(' ').map((s) => s.toLowerCase())
  switch (cmd) {
    case 'exit':
    case 'quit':
      console.log('👋 FieldSight closed.')
      return true
    case 'help':
      console.log(
        [
          'FieldSight — capture installed-base observations with your voice or text.',
          '',
          'Just type what you saw, e.g.:',
          '  "I\'m at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT."',
          '',
          'Commands:',
          '  /help            this help',
          '  /dashboard       installed-base summary (customer 360 + geographics)',
          '  /customers       list known customers',
          '  /query <nl>      natural-language analytics, e.g. /query clients in Brazil with MR over 7 years',
          '  /evidence        export auditable inference log (evidence.csv)',
          '  /exit            quit',
        ].join('\n'),
      )
      return false
    case 'stats':
    case 'dashboard': {
      const s = globalStats(db)
      console.log(`\n📊 INSTALLED BASE — ${s.totalCustomers} customers, ${s.totalObservations} observations, ${s.totalUnits} units`)
      console.log(`   By modality: ${Object.entries(s.byModality).map(([k, v]) => `${k}=${v}`).join(', ')}`)
      console.log(`   By country: ${Object.entries(s.byCountry).map(([k, v]) => `${k}=${v}`).join(', ')}`)
      console.log(`   Stale sites (>180d): ${s.staleCount}`)
      if (s.refreshCandidates.length) {
        console.log('   🔄 Refresh opportunities:')
        for (const c of s.refreshCandidates) {
          const old = c.equipment.filter((e) => e.oldestQuantity > 0)
          console.log(`     • ${c.customer.name} (${c.customer.country}) — ${old.map((e) => `${e.oldestQuantity}× ${e.modality} ≥7y`).join(', ')}`)
        }
      }
      return false
    }
    case 'customers': {
      const customers = allCustomers(db)
      console.log(`\n🏥 Known customers (${customers.length}):`)
      for (const c of customers) {
        const c360 = customer360(db, c)
        console.log(`   • ${c.name} — ${c.city}, ${c.country} — ${c360.totalUnits} units, ${c360.observationCount} obs${c360.staleDays !== undefined && c360.staleDays > 180 ? ' ⚠ stale' : ''}`)
      }
      return false
    }
    case 'query': {
      const q = rest.join(' ')
      if (!q) {
        console.log('Usage: /query <natural language>, e.g. /query customers in Brazil with MR older than 7 years')
        return false
      }
      const res = queryInstalledBase(db, q)
      console.log(`\n🔍 Query: "${q}"`)
      console.log(`   Match: country=${res.country ?? 'any'}, modality=${res.modality ?? 'any'}, age>${res.ageThreshold ?? 'any'}`)
      if (!res.results.length) {
        console.log('   No matching customers.')
        return false
      }
      for (const r of res.results) {
        const aged = res.ageThreshold ? `, ${r.agedUnits} units ≥${res.ageThreshold}y` : ''
        console.log(`   • ${r.customer.name} (${r.customer.city}, ${r.customer.country}) — ${r.matchingQuantity} ${r.modality ?? 'units'}${aged}`)
      }
      return false
    }
    case 'evidence': {
      const csv = exportEvidenceCsv()
      const p = join(process.cwd(), 'evidence', 'evidence.csv')
      writeFileSync(p, csv)
      console.log(`\n📝 Evidence log exported to ${p}`)
      return false
    }
    default:
      console.log('Unknown command. Use /help.')
      return false
  }
}

export async function runCli(opts: CliOptions): Promise<void> {
  initEvidence()
  const db = openDb()
  const inference = await createInference()
  const conversation = new Conversation(db, inference.extract, opts.observer, opts.autoSave, opts.source)

  console.log('\n═══════════════════════════════════════════════')
  console.log('  FieldSight — Customer Installed Base Intelligence')
  console.log('  Local AI by QVAC · Philips Hackathon Challenge')
  console.log('═══════════════════════════════════════════════\n')
  console.log('Describe what you observed at the customer site, or type /help.\n')

  const rl = readline.createInterface({ input, output })
  let closed = false
  rl.on('close', () => { closed = true })

  try {
    while (!closed) {
      const line = (await rl.question('🩺 you> ')).trim()
      if (!line) continue
      if (line.startsWith('/') && line !== '/new') {
        if (await handleCommand(line.slice(1), db)) break
        continue
      }

      try {
        const reply = await conversation.turn(line)
        console.log('FieldSight> ' + reply.message)
        if (reply.observation) console.table(reply.observation.equipment.map(e => ({ quantity: e.quantity, modality: e.modality, brand: e.brand, model: e.model, age: e.age?.qualitative ?? e.age?.min ?? 'Unknown' })))
        for (const f of reply.followUps) console.log('  ' + f.question)
        if (reply.observation && !reply.saved) console.log('Reply with more details, confirm, save anyway (duplicates), or skip.')
      } catch (error) {
        console.error('Could not process observation:', error instanceof Error ? error.message : error)
      }
    }
  } finally {
    try { await inference.dispose() } finally { rl.close(); db.close() }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const observer = process.env.FIELDSIGHT_OBSERVER ?? 'Field User 01'
  const autoSave = process.env.FIELDSIGHT_AUTOSAVE === '1'
  runCli({ observer, autoSave, source: 'Text' }).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}