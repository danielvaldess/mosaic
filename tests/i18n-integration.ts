import { openDb } from '../src/store/db.js'
import { Conversation } from '../src/agent/conversation.js'
import { detectLang, buildFollowUpQuestion, buildEquipmentSummary } from '../src/agent/i18n.js'

// Mock extractor that returns a basic extraction
const mockExtract = async (text: string) => {
  const lang = detectLang(text)
  return {
    customer: { name: 'Hospital Test', city: 'Test City', country: 'Test Country' },
    equipment: [{ modality: 'MR', quantity: 2, brand: 'Unknown', model: 'Unknown' }],
    missingFields: [
      { field: 'brand', modality: 'MR', reason: 'not provided' },
      { field: 'age', modality: 'MR', reason: 'not provided' },
    ],
  }
}

async function testLanguage(lang: string, input: string) {
  const db = openDb(':memory:')
  const conversation = new Conversation(db, mockExtract, 'tester')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`🌍 IDIOMA: ${lang.toUpperCase()}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`📥 Input: "${input}"`)
  console.log(`🔍 Detectado: ${detectLang(input)}`)

  try {
    const reply = await conversation.turn(input)
    console.log(`\n📤 Respuesta:`)
    console.log(`   ${reply.message}`)
    if (reply.followUps.length > 0) {
      console.log(`\n❓ Follow-ups:`)
      for (const fu of reply.followUps) {
        console.log(`   - ${fu.question}`)
      }
    }
    console.log(`\n✅ Status: OK`)
  } catch (error) {
    console.log(`\n❌ Error: ${error instanceof Error ? error.message : error}`)
  } finally {
    db.close()
  }
}

async function runTests() {
  console.log('🚀 INICIANDO TESTS MULTIIDIOMA\n')

  // Tests por idioma
  const tests = [
    // Español
    { lang: 'es', input: 'Estoy en Hospital DemoCare en Panamá. Tienen dos resonadores magnéticos y un tomógrafo.' },
    { lang: 'es', input: '¿Cuántos equipos de MR viste?' },
    { lang: 'es', input: 'Tienen dos ecógrafos en la clínica Santa María, Bogotá, Colombia.' },

    // Inglés
    { lang: 'en', input: "I'm at Hospital DemoCare in Panama. They have two MR systems and one CT scanner." },
    { lang: 'en', input: 'What brand is the ultrasound?' },
    { lang: 'en', input: 'They have two ultrasound machines at City Hospital, Panama City.' },

    // Portugués
    { lang: 'pt', input: 'Estive no Hospital DemoCare em Panamá. Eles têm duas ressonâncias magnéticas e um tomógrafo.' },
    { lang: 'pt', input: 'Qual é a marca do equipamento?' },

    // Francés
    { lang: 'fr', input: "J'ai visité l'hôpital DemoCare à Panama. Ils ont deux IRM et un scanner." },
    { lang: 'fr', input: "Quelle est la marque de l'échographe?" },

    // Alemán
    { lang: 'de', input: 'Ich war im Krankenhaus DemoCare in Panama. Sie haben zwei MRT-Geräte und ein CT-Gerät.' },
    { lang: 'de', input: 'Welche Marke hat das CT-Gerät?' },

    // Italiano
    { lang: 'it', input: "Sono stato all'ospedale DemoCare a Panama. Hanno due risonanze magnetiche e un tomografo." },
    { lang: 'it', input: 'Quale marca è il tomografo?' },

    // Neerlandés
    { lang: 'nl', input: 'Ik was in het ziekenhuis DemoCare in Panama. Ze hebben twee MRI-systemen en een CT-scanner.' },
    { lang: 'nl', input: 'Welk merk heeft de CT-scanner?' },
  ]

  for (const test of tests) {
    await testLanguage(test.lang, test.input)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 RESUMEN DE DETECCIÓN DE IDIOMA')
  console.log(`${'='.repeat(60)}`)

  const detectionTests = [
    { input: 'Estoy en Panamá', expected: 'es' },
    { input: "I'm in Panama", expected: 'en' },
    { input: 'Estive em São Paulo', expected: 'pt' },
    { input: "J'ai visité Paris", expected: 'fr' },
    { input: 'Ich war in Berlin', expected: 'de' },
    { input: 'Sono stato a Roma', expected: 'it' },
    { input: 'Ik was in Amsterdam', expected: 'nl' },
  ]

  let passed = 0
  let failed = 0

  for (const test of detectionTests) {
    const detected = detectLang(test.input)
    const ok = detected === test.expected
    if (ok) passed++
    else failed++
    console.log(`${ok ? '✅' : '❌'} "${test.input}" → ${detected} (esperado: ${test.expected})`)
  }

  console.log(`\n📈 Resultado: ${passed}/${passed + failed} pasaron`)
  if (failed > 0) console.log(`⚠️  ${failed} fallaron`)
}

runTests().catch(console.error)
