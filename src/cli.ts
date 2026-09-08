import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import Database from 'better-sqlite3'
import { openDb, findOrCreateCustomer, allCustomers } from './store/db.js'
import { extractObservation, loadExtractionModel, unloadExtractionModel } from './extract/extractor.js'
import { handleObservation, type AgentReply } from './agent/agent.js'
import { customer360, globalStats, queryInstalledBase } from './insights/insights.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface CliOptions {
  observer: string
  autoSave: boolean
  source: 'Voice' | 'Text'
}

const COMMANDS = new Set([
  'exit', 'quit', 'help', 'dashboard', 'customers', 'query', 'evidence', 'stats',
])

async function handleCommand(rl: readline.Interface, line: string, db: Database.Database, opts: CliOptions): Promise<boolean> {
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
      return false
  }
}

export async function runCli(opts: CliOptions): Promise<void> {
  initEvidence()
  const db = openDb()
  const modelId = await loadExtractionModel()

  console.log('\n═══════════════════════════════════════════════')
  console.log('  FieldSight — Customer Installed Base Intelligence')
  console.log('  Local AI by QVAC · Philips Hackathon Challenge')
  console.log('═══════════════════════════════════════════════\n')
  console.log('Describe what you observed at the customer site, or type /help.\n')

  const rl = readline.createInterface({ input, output })

  try {
    while (true) {
      const line = (await rl.question('🩺 you> ')).trim()
      if (!line) continue
      if (line.startsWith('/')) {
        if (await handleCommand(rl, line.slice(1), db, opts)) break
        continue
      }

      const start = Date.now()
      const { extraction } = await extractObservation(line, modelId)

      if (!extraction.customer?.name) {
        const ask = await rl.question(`🤖 FieldSight> Which customer/hospital are you at? `)
        const loc = await rl.question(`🤖 FieldSight> In which city and country? `)
        const [cityRaw, countryRaw] = loc.split(',').map((s) => s.trim())
        const city = cityRaw ?? ''
        const country = countryRaw ?? ''
        extraction.customer = {
          ...(extraction.customer ?? {}),
          name: ask.trim(),
          city,
          country,
        }
      }

      const customer = findOrCreateCustomer(db, {
        name: extraction.customer.name!,
        city: extraction.customer.city ?? 'Unknown',
        country: extraction.customer.country ?? 'Unknown',
        site: extraction.customer.site,
      })

      let reply: AgentReply = handleObservation({
        db,
        extraction,
        customer,
        observer: opts.observer,
        observedAt: new Date().toISOString(),
        rawInput: line,
        source: opts.source,
        autoSave: opts.autoSave,
      })

      console.log(`🤖 FieldSight> ${reply.message} (${Date.now() - start}ms)`)

      // Follow-up loop
      let turn = 0
      while (reply.followUps.length > 0 && turn < 4) {
        for (const f of reply.followUps) {
          const ans = await rl.question(`🤖 FieldSight> ${f.question} `)
          if (ans.trim()) {
            const merged = await extractObservation(`${reply.observation?.rawInput ?? line}. Follow-up: ${f.question} -> ${ans}`, modelId)
            reply = handleObservation({
              db,
              extraction: { ...extraction, ...merged.extraction, equipment: [...(merged.extraction.equipment.length ? merged.extraction.equipment : extraction.equipment)] },
              customer,
              observer: opts.observer,
              observedAt: new Date().toISOString(),
              rawInput: line,
              source: opts.source,
              autoSave: opts.autoSave,
            })
            console.log(`🤖 FieldSight> ${reply.message}`)
            if (reply.saved) break
          }
        }
        turn++
        if (reply.saved) break
      }

      if (!reply.saved && reply.observation && reply.observation.equipment.length > 0) {
        const confirm = await rl.question(`🤖 FieldSight> Confirm and save? [y/N] `)
        if (confirm.trim().toLowerCase() === 'y') {
          const confirmed = handleObservation({
            db,
            extraction,
            customer,
            observer: opts.observer,
            observedAt: new Date().toISOString(),
            rawInput: line,
            source: opts.source,
            autoSave: true,
          })
          console.log(`🤖 FieldSight> ${confirmed.message}`)
        }
      }
    }
  } finally {
    await unloadExtractionModel(modelId)
    rl.close()
    db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const observer = process.env.FIELDSIGHT_OBSERVER ?? 'Field User 01'
  const autoSave = process.env.FIELDSIGHT_AUTOSAVE === '1'
  runCli({ observer, autoSave, source: 'Text' }).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}