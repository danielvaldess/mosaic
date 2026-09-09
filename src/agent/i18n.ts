/**
 * Language detection and natural message templates for the conversational agent.
 * Auto-detects the user's language and responds in the same language.
 * Supports: en, es, pt, fr, de, it, nl
 */

// ─── Language detection ────────────────────────────────────────────────────────

export type Lang = 'en' | 'es' | 'pt' | 'fr' | 'de' | 'it' | 'nl'

/**
 * Detect language from user input using weighted keyword signals.
 * Returns the best match or 'en' as fallback.
 */
export function detectLang(text: string): Lang {
  const lower = text.toLowerCase().trim()
  const scores: Record<Lang, number> = { en: 0, es: 0, pt: 0, fr: 0, de: 0, it: 0, nl: 0 }

  // ── Quick greeting detection (short messages) ──
  if (lower.length < 20) {
    if (/(hola|buenas|buenos|buenas tardes|buenas noches|oye|mira|che)/.test(lower)) { scores.es += 10; return 'es' }
    if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(lower)) { scores.en += 10; return 'en' }
    if (/(bonjour|salut|bonsoir|coucou)/.test(lower)) { scores.fr += 10; return 'fr' }
    if (/\b(hallo|guten|servus|grüß)\b/.test(lower)) { scores.de += 10; return 'de' }
    if (/(ciao|salve|buongiorno|buonasera)/.test(lower)) { scores.it += 10; return 'it' }
    if (/\b(hoi|goedemorgen|goedemiddag)\b/.test(lower)) { scores.nl += 10; return 'nl' }
    if (/(olá|oi|bom dia|boa tarde|boa noite|opa)/.test(lower)) { scores.pt += 10; return 'pt' }
  }

  // ── English ──
  // Strong signals (unambiguous English words) — weight by number of matches
  const enStrong = lower.match(/\b(I'm|I am|I have|I was|they have|there are|what|which|how many|the|and|or|but|is|are|was|were|have|has|had|do|does|did|can|could|will|would|should|may|might|must|shall)\b/g)
  if (enStrong) scores.en += enStrong.length
  // Common English medical/field terms
  if (/\b(hospital|clinic|system|monitor|equipment|brand|model|age|years|old|new|unit|units|machine|machines|device|devices)\b/i.test(lower)) scores.en += 1

  // ── Spanish ──
  // Strong signals (unambiguous Spanish words)
  if (/\b(estoy|estuve|visité|tienen|tuvieron|resonador|resonancia|magnético|magnetica|tomógrafo|tomografo|ecógrafo|ecografo|antigüedad|antiguedad|observé|observo|cuántos|cuantos|cuál|cual|dónde|donde|quién|quien|también|tambien|después|despues|ahora|puedo|voy|fui|estaba|está|estás|necesito|falta)\b/.test(lower)) scores.es += 4
  // Country/city names with Spanish-specific accents (strong signal)
  if (/\b(panamá|méxico|colombia|perú|argentina|ecuador|venezuela|uruguay|paraguay|bolivia|guatemala|honduras|costa rica|nicaragua|república dominicana|cuba|puerto rico)\b/.test(lower)) scores.es += 6
  // Spanish-specific characters
  if (/[áéíóúñ¿¡]/.test(text)) scores.es += 5
  // Common shared words that are NOT unique to Spanish (lower weight, but count matches)
  const esShared = lower.match(/\b(el|la|los|las|en|del|que|esta|está|unos|unas|por|con|para|como|pero|mas|más|y)\b/g)
  if (esShared) scores.es += esShared.length
  if (/\b(clínica|clinica|equipo|equipos|marca|modelo|ciudad|país|pais|uno|una|dos|tres|cuatro|cinco)\b/.test(lower)) scores.es += 1

  // ── Portuguese ──
  // Strong signals (unambiguous Portuguese words)
  if (/\b(estou|estive|visitei|têm|tiveram|ressonância|ressonancia|magnética|magnetica|ecógrafo|ecografo|antiguidade|observei|observo|quantos|qual|onde|quem|também|tambem|depois|agora|posso|vou|fui|estava|está|preciso|falta|duas|nós|nosso|nossa|então|porém|também|ainda)\b/.test(lower)) scores.pt += 4
  // Brazilian cities
  if (/\b(são paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|recife|salvador|fortaleza|brasília|brasilia|campinas|florianópolis)\b/.test(lower)) scores.pt += 6
  // Portuguese-specific characters (ã, õ, ç are very strong signals)
  if (/[ãõ]/.test(text)) scores.pt += 6
  if (/[ç]/.test(text)) scores.pt += 3
  // Common shared words (low weight)
  if (/\b(hospital|clínica|clinico|equipamento|equipamentos|marca|modelo|cidade|país|um|uma|dois|duas|três|tres|quatro|cinco)\b/.test(lower)) scores.pt += 1

  // ── French ──
  if (/\b(j'ai|j'ai visité|j'ai vu|hôpital|hopital|aimantique|résonance|resonance|tomographe|échographe|echographe|ancienneté|anciennete|observe|besoin|manque|combien|quelle|aussi|après|apres|maintenant|peut|vais|étais|était|ete|peux)\b/.test(lower)) scores.fr += 4
  if (/\b(paris|lyon|marseille|toulouse|nice|bordeaux|lille|strasbourg|nantes|montpellier|rennes)\b/.test(lower)) scores.fr += 6
  if (/[àâéèêëîïôùûüç]/.test(text)) scores.fr += 5
  if (/\b(clinique|équipement|equipement|marque|modèle|modele|ans|ville|pays|un|une|deux|trois|quatre|cinq)\b/.test(lower)) scores.fr += 1

  // ── German ──
  if (/\b(ich bin|ich habe|besucht|gesehen|haben|magnetresonanz|mrt|ultraschall|geräte|gerät|krankenhaus|klinik|stadt|land|beobachte|brauche|fehlt|welcher|welche|auch|nach|jetzt|kann|werde|bin|war|ist|sind|hab)\b/.test(lower)) scores.de += 4
  if (/\b(berlin|hamburg|münchen|munchen|köln|koln|frankfurt|stuttgart|düsseldorf|dusseldorf|dortmund|essen|leipzig|bremen|dresden|hannover|nürnberg|nuernberg)\b/.test(lower)) scores.de += 6
  if (/[äöüß]/.test(text)) scores.de += 5
  if (/\b(geräte|gerate|marke|modell|jahre|stadt|land|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\b/.test(lower)) scores.de += 1

  // ── Italian ──
  if (/\b(sono|ho|visitato|veduto|hanno|ospedale|risonanza|magnetica|tomografo|ecografo|apparecchiatura|antichità|antichita|osservo|bisogno|manca|quanti|quale|dove|chi|anche|dopo|adesso|posso|vado|stavo|stava|era|sono|avere)\b/.test(lower)) scores.it += 4
  if (/\b(roma|milano|napoli|torino|palermo|genova|bologna|firenze|bari|catania|venezia|verona|messina|padova|trieste)\b/.test(lower)) scores.it += 6
  if (/[àèéìíîòóùú]/.test(text)) scores.it += 5
  if (/\b(apparecchiatura|marca|modello|età|anni|città|paese|un|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b/.test(lower)) scores.it += 1

  // ── Dutch ──
  if (/\b(ik ben|ik heb|bezocht|gezien|hebben|ziekenhuis|magnetisch|resonantie|tomograaf|echograaf|apparatuur|observeer|nodig|ontbreekt|hoeveel|welke|welk|waar|ook|na|nu|kan|ga|was|ben|is|zijn|heb)\b/.test(lower)) scores.nl += 4
  if (/\b(amsterdam|rotterdam|den haag|the hague|utrecht|eindhoven|groningen|tilburg|almere|breda|nijmegen|apeldoorn|haarlem|arnhem)\b/.test(lower)) scores.nl += 6
  if (/[ëï]/.test(text)) scores.nl += 5
  if (/\b(apparaat|merk|model|leeftijd|stad|land|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b/.test(lower)) scores.nl += 1

  // ── Find the winner ──
  let best: Lang = 'en'
  let bestScore = 0
  for (const [lang, score] of Object.entries(scores) as [Lang, number][]) {
    if (score > bestScore) { bestScore = score; best = lang }
  }
  return best
}

// ─── Modality labels ───────────────────────────────────────────────────────────

const MODALITY_LABELS: Record<string, Record<Lang, string>> = {
  MR: { en: 'MR system', es: 'resonador magnético', pt: 'ressonância magnética', fr: 'IRM', de: 'MRT-Gerät', it: 'risonanza magnetica', nl: 'MRI-systeem' },
  CT: { en: 'CT scanner', es: 'tomógrafo', pt: 'tomógrafo', fr: 'scanner', de: 'CT-Gerät', it: 'tomografo', nl: 'CT-scanner' },
  Ultrasound: { en: 'ultrasound', es: 'ecógrafo', pt: 'ecógrafo', fr: 'échographe', de: 'Ultraschallgerät', it: 'ecografo', nl: 'echograaf' },
  'X-Ray': { en: 'X-Ray', es: 'equipo de rayos X', pt: 'raios X', fr: 'radiographie', de: 'Röntgengerät', it: 'raggi X', nl: 'röntgenapparaat' },
  'Patient Monitoring': { en: 'patient monitor', es: 'monitor de pacientes', pt: 'monitor de pacientes', fr: 'moniteur patient', de: 'Patientenmonitor', it: 'monitore paziente', nl: 'patiëntenmonitor' },
  'Image Guided Therapy': { en: 'image-guided therapy', es: 'terapia guiada por imagen', pt: 'terapia guiada por imagem', fr: 'thérapie guidée par imagerie', de: 'bildgesteuerte Therapie', it: 'terapia guidata', nl: 'beeldgestuurde therapie' },
}

export function modalityLabel(canonical: string, lang: Lang): string {
  const labels = MODALITY_LABELS[canonical]
  if (!labels) return canonical
  return labels[lang] ?? labels.en
}

export function modalityLabelPlural(canonical: string, quantity: number, lang: Lang): string {
  const label = modalityLabel(canonical, lang)
  if (quantity === 1) return label
  switch (lang) {
    case 'es': {
      // Handle compound adjectives: "resonador magnético" → "resonadores magnéticos"
      const words = label.split(' ')
      if (words.length > 1) {
        const noun = words[0]!
        const adj = words.slice(1).join(' ')
        const nounPlural = noun.endsWith('or') ? noun.slice(0, -2) + 'ores'
          : noun.endsWith('ó') ? noun.slice(0, -1) + 'oes'
          : noun.endsWith('o') ? noun.slice(0, -1) + 'os'
          : noun + 'es'
        const adjPlural = adj.endsWith('ico') ? adj.slice(0, -1) + 'os'
          : adj.endsWith('a') ? adj.slice(0, -1) + 'os'
          : adj
        return `${nounPlural} ${adjPlural}`
      }
      if (label.endsWith('ó')) return label.slice(0, -1) + 'oes'
      if (label.endsWith('o')) return label.slice(0, -1) + 'os'
      return label + 'es'
    }
    case 'pt':
      if (label.endsWith('ão')) return label.slice(0, -2) + 'ões'
      if (label.endsWith('o')) return label.slice(0, -1) + 'os'
      return label + 's'
    case 'fr': {
      // French: most nouns just add 's', but acronyms stay unchanged
      if (/^[A-Z]{2,}$/.test(label)) return label
      return label + 's'
    }
    case 'de':
      return label + 'e'
    case 'it':
      if (label.endsWith('a')) return label.slice(0, -1) + 'e'
      if (label.endsWith('o')) return label.slice(0, -1) + 'i'
      return label + 'i'
    case 'nl': {
      // Dutch: "systeem" → "systemen", "apparaat" → "apparaten"
      if (label.endsWith('systeem')) return label.slice(0, -6) + 'systemen'
      if (label.endsWith('apparaat')) return label.slice(0, -6) + 'apparaten'
      return label + 'en'
    }
    default:
      return label + 's'
  }
}

// ─── Contextual follow-up questions ───────────────────────────────────────────

interface FollowUpTemplate {
  question: (modalityLabel: string, lang: Lang) => string
  reason?: (lang: Lang) => string
}

const FOLLOW_UP_TEMPLATES: Record<string, FollowUpTemplate> = {
  brand: {
    question: (mod, lang) => ({
      en: `What brand is the ${mod}?`,
      es: `¿Qué marca es el ${mod}?`,
      pt: `Qual é a marca do ${mod}?`,
      fr: `Quelle est la marque de l'${mod}?`,
      de: `Welche Marke hat das ${mod}?`,
      it: `Quale marca è la ${mod}?`,
      nl: `Welk merk heeft de ${mod}?`,
    }[lang]),
    reason: (lang) => ({
      en: 'Knowing the manufacturer helps track equipment lifecycle',
      es: 'Conocer el fabricante ayuda a rastrear el ciclo de vida del equipo',
      pt: 'Conhecer o fabricante ajuda a rastrear o ciclo de vida do equipamento',
      fr: "Connaître le fabricant aide à suivre le cycle de vie de l'équipement",
      de: 'Der Hersteller hilft, den Lebenszyklus des Geräts zu verfolgen',
      it: 'Conoscere il produttore aiuta a tracciare il ciclo di vita del dispositivo',
      nl: 'De fabrikant kennen helpt de levenscyclus van het apparaat te volgen',
    }[lang]),
  },
  model: {
    question: (mod, lang) => ({
      en: `Do you know the exact model of the ${mod}?`,
      es: `¿Sabes el modelo exacto del ${mod}?`,
      pt: `Você sabe o modelo exato do ${mod}?`,
      fr: `Connaissez-vous le modèle exact de l'${mod}?`,
      de: `Kennen Sie das genaue Modell des ${mod}?`,
      it: `Conosci il modello esatto della ${mod}?`,
      nl: `Weet u het exacte model van de ${mod}?`,
    }[lang]),
    reason: (lang) => ({
      en: 'The model helps cross-reference with upgrade databases',
      es: 'El modelo permite comparar con bases de datos de actualizaciones',
      pt: 'O modelo permite comparar com bancos de dados de atualizações',
      fr: "Le modèle permet de croiser avec les bases de données de mises à jour",
      de: 'Das Modell ermöglicht den Abgleich mit Aktualisierungsdatenbanken',
      it: 'Il modello consente il confronto con i database di aggiornamenti',
      nl: 'Het model maakt kruisverwijzing met upgrade-databases mogelijk',
    }[lang]),
  },
  age: {
    question: (mod, lang) => ({
      en: `About how old is the ${mod}? (approximate is fine)`,
      es: `¿Cuántos años tiene el ${mod}? (más o menos)`,
      pt: `Approximadamente quantos anos tem o ${mod}? (aproximado está ok)`,
      fr: `Quel âge a l'${mod} environ? (une estimation suffit)`,
      de: `Wie alt ist das ${mod} ungefähr? (Schätzwert reicht)`,
      it: `Quanti anni ha la ${mod} circa? (una stima va bene)`,
      nl: `Hoe oud is de ${mod} ongeveer? (een schatting is prima)`,
    }[lang]),
    reason: (lang) => ({
      en: 'Age is key for identifying refresh opportunities',
      es: 'La antigüedad es clave para identificar oportunidades de renovación',
      pt: 'A antiguidade é fundamental para identificar oportunidades de renovação',
      fr: "L'ancienneté est essentielle pour identifier les opportunités de renouvellement",
      de: 'Das Alter ist entscheidend für Erneuerungsmöglichkeiten',
      it: "L'antichità è fondamentale per identificare opportunità di rinnovo",
      nl: 'De leeftijd is essentieel voor het identificeren van vernieuwingsmogelijkheden',
    }[lang]),
  },
  quantity: {
    question: (mod, lang) => ({
      en: `How many ${mod} units did you see in total?`,
      es: `¿Cuántos equipos de ${mod} viste en total?`,
      pt: `Quantos equipamentos de ${mod} você viu no total?`,
      fr: `Combien d'unités de ${mod} avez-vous vues au total?`,
      de: `Wie viele ${mod}-Geräte haben Sie insgesamt gesehen?`,
      it: `Quanti dispositivi ${mod} hai visto in totale?`,
      nl: `Hoeveel ${mod}-apparaten heeft u in totaal gezien?`,
    }[lang]),
  },
  customer: {
    question: (_mod, lang) => ({
      en: 'Which hospital or clinic were you at? Include city and country.',
      es: '¿En qué hospital o clínica estuviste? Incluye ciudad y país.',
      pt: 'Em qual hospital ou clínica você esteve? Inclua cidade e país.',
      fr: "Dans quel hôpital ou clinique étiez-vous? Incluez la ville et le pays.",
      de: 'In welchem Krankenhaus oder welcher Klinik waren Sie? Bitte Stadt und Land angeben.',
      it: 'In quale ospedale o clinica sei stato? Includi città e paese.',
      nl: 'In welk ziekenhuis of welke kliniek was u? Vermeld stad en land.',
    }[lang]),
  },
  location: {
    question: (_mod, lang) => ({
      en: 'What city and country is this client in?',
      es: '¿En qué ciudad y país queda este cliente?',
      pt: 'Em que cidade e país fica este cliente?',
      fr: 'Dans quelle ville et quel pays se trouve ce client?',
      de: 'In welcher Stadt und welchem Land befindet sich dieser Kunde?',
      it: 'In quale città e paese si trova questo cliente?',
      nl: 'In welke stad en welk land bevindt zich deze klant?',
    }[lang]),
  },
  notes: {
    question: (_mod, lang) => ({
      en: 'Anything else you want to add about this visit?',
      es: '¿Algo más que quieras agregar sobre esta visita?',
      pt: 'Algo mais que você queira adicionar sobre esta visita?',
      fr: "Quelque chose d'autre à ajouter sur cette visite?",
      de: 'Möchten Sie noch etwas zu diesem Besuch hinzufügen?',
      it: "C'è qualcos'altro da aggiungere su questa visita?",
      nl: 'Wilt u nog iets toevoegen over dit bezoek?',
    }[lang]),
  },
}

export function buildFollowUpQuestion(
  field: string,
  modality: string | undefined,
  lang: Lang,
): string {
  const template = FOLLOW_UP_TEMPLATES[field] ?? FOLLOW_UP_TEMPLATES.notes!
  const mod = modality ? modalityLabel(modality, lang) : ''
  return template.question(mod, lang)
}

export function buildFollowUpReason(field: string, lang: Lang): string | undefined {
  const template = FOLLOW_UP_TEMPLATES[field]
  return template?.reason?.(lang)
}

// ─── Response messages ─────────────────────────────────────────────────────────

const M: Record<string, Record<Lang, string>> = {
  identified: {
    en: 'Noted {summary} at {location}.',
    es: 'Registré {summary} en {location}.',
    pt: 'Registrei {summary} em {location}.',
    fr: '{summary} noté à {location}.',
    de: '{summary} erfasst in {location}.',
    it: '{summary} registrato a {location}.',
    nl: '{summary} genoteerd in {location}.',
  },
  followUpIntro: {
    en: 'I have a few questions to complete this observation:',
    es: 'Tengo algunas preguntas para completar esta observación:',
    pt: 'Tenho algumas perguntas para completar esta observação:',
    fr: "J'ai quelques questions pour compléter cette observation:",
    de: 'Ich habe ein paar Fragen, um diese Beobachtung zu vervollständigen:',
    it: 'Ho alcune domande per completare questa osservazione:',
    nl: 'Ik heb een paar vragen om deze observatie compleet te maken:',
  },
  readyToSave: {
    en: 'Ready to save. Reply "confirm" to store it, or tell me more.',
    es: 'Lista para guardar. Responde "confirmar" para almacenarla, o cuéntame más.',
    pt: 'Pronta para salvar. Responda "confirmar" para armazenar, ou conte mais.',
    fr: 'Prête à enregistrer. Répondez "confirmer" pour sauvegarder, ou racontez-moi plus.',
    de: 'Bereit zum Speichern. Antworten Sie "bestätigen" oder erzählen Sie mir mehr.',
    it: 'Pronta per salvare. Rispondi "conferma" per memorizzare, o raccontami di più.',
    nl: 'Gereed om op te slaan. Antwoord "bevestigen" om op te slaan, of vertel meer.',
  },
  noEquipment: {
    en: 'I could not identify any medical equipment in that message. Which modality did you observe?',
    es: 'No identifiqué equipo médico en tu mensaje. ¿Qué modalidad observaste?',
    pt: 'Não identifiquei nenhum equipamento médico na sua mensagem. Qual modalidade você observou?',
    fr: "Je n'ai identifié aucun équipement médical dans votre message. Quelle modalité avez-vous observée?",
    de: 'Ich konnte keine medizinischen Geräte in dieser Nachricht identifizieren. Welche Modalität haben Sie beobachtet?',
    it: 'Non ho identificato dispositivi medici nel tuo messaggio. Quale modalità hai osservato?',
    nl: 'Ik kon geen medische apparaten in uw bericht identificeren. Welke modaliteit heeft u waargenomen?',
  },
  needLocation: {
    en: 'Which hospital, city and country? Reply here to complete this observation.',
    es: '¿En qué hospital o clínica estuviste? Incluye ciudad y país para completar la observación.',
    pt: 'Em qual hospital ou clínica você esteve? Inclua cidade e país para completar a observação.',
    fr: "Dans quel hôpital ou clinique étiez-vous? Incluez la ville et le pays pour compléter l'observation.",
    de: 'In welchem Krankenhaus und in welcher Stadt/Land waren Sie? Bitte hier antworten, um die Beobachtung zu vervollständigen.',
    it: 'In quale ospedale o clinica sei stato? Includi città e paese per completare la osservazione.',
    nl: 'In welk ziekenhuis, stad en land was u? Antwoord hier om de observatie compleet te maken.',
  },
  needQuantity: {
    en: 'How many {mod} did you observe? Please provide the quantity before saving.',
    es: '¿Cuántos {mod} viste? Necesito la cantidad antes de guardar.',
    pt: 'Quantos {mod} você observou? Preciso da quantidade antes de salvar.',
    fr: "Combien d'{mod} avez-vous observé? Veuillez fournir la quantité avant d'enregistrer.",
    de: 'Wie viele {mod} haben Sie beobachtet? Bitte geben Sie die Anzahl vor dem Speichern an.',
    it: 'Quanti {mod} hai osservato? Fornisci la quantità prima di salvare.',
    nl: 'Hoeveel {mod} heeft u waargenomen? Geef het aantal op voordat u opslaat.',
  },
  saved: {
    en: 'Saved observation ({status}).',
    es: 'Observación guardada ({status}).',
    pt: 'Observação salva ({status}).',
    fr: 'Observation enregistrée ({status}).',
    de: 'Beobachtung gespeichert ({status}).',
    it: 'Osservazione salvata ({status}).',
    nl: 'Observatie opgeslagen ({status}).',
  },
  draftDiscarded: {
    en: 'Draft discarded. Describe a new observation.',
    es: 'Borrador descartado. Describe una nueva observación.',
    pt: 'Rascunho descartado. Descreva uma nova observação.',
    fr: 'Brouillon abandonné. Décrivez une nouvelle observation.',
    de: 'Entwurf verworfen. Beschreiben Sie eine neue Beobachtung.',
    it: 'Bozza eliminata. Descrivi una nuova osservazione.',
    nl: 'Concept verworpen. Beschrijf een nieuwe observatie.',
  },
  noPending: {
    en: 'No pending observation. Describe what you observed first.',
    es: 'No hay observación pendiente. Describe lo que observaste primero.',
    pt: 'Nenhuma observação pendente. Descreva o que você observou primeiro.',
    fr: "Aucune observation en attente. Décrivez d'abord ce que vous avez observé.",
    de: 'Keine ausstehende Beobachtung. Beschreiben Sie zuerst, was Sie beobachtet haben.',
    it: 'Nessuna osservazione in sospeso. Descrivi prima ciò che hai osservato.',
    nl: 'Geen openstaande observatie. Beschrijf eerst wat u heeft waargenomen.',
  },
  duplicateWarning: {
    en: 'Possible duplicates found. Reply "save anyway" to add a new observation, or "skip".',
    es: 'Se encontraron posibles duplicados. Responde "guardar de todos modos" para agregar una observación nueva, o "omitir".',
    pt: 'Possíveis duplicatas encontradas. Responda "salvar mesmo assim" para adicionar uma nova observação, ou "pular".',
    fr: 'Doublons possibles identifiés. Répondez "enregistrer quand même" pour ajouter une nouvelle observation, ou "ignorer".',
    de: 'Mögliche Duplikate gefunden. Antworten Sie "trotzdem speichern", um eine neue Beobachtung hinzuzufügen, oder "überspringen".',
    it: 'Possibili duplicati trovati. Rispondi "salva comunque" per aggiungere una nuova osservazione, o "ignora".',
    nl: 'Mogelijke duplicaten gevonden. Antwoord "toch opslaan" om een nieuwe observatie toe te voegen, of "overslaan".',
  },
  alreadySaved: {
    en: 'This observation is already saved.',
    es: 'Esta observación ya fue guardada.',
    pt: 'Esta observação já foi salva.',
    fr: "Cette observation est déjà enregistrée.",
    de: 'Diese Beobachtung wurde bereits gespeichert.',
    it: 'Questa osservazione è già stata salvata.',
    nl: 'Deze observatie is al opgeslagen.',
  },
  tooLong: {
    en: 'Observation too long. Confirm or use /new to start again.',
    es: 'La observación es demasiado larga. Confirma con "confirmar" o usa /new para empezar de nuevo.',
    pt: 'Observação muito longa. Confirme com "confirmar" ou use /new para recomeçar.',
    fr: 'Observation trop longue. Confirmez avec "confirmer" ou utilisez /new pour recommencer.',
    de: 'Beobachtung zu lang. Bestätigen Sie mit "bestätigen" oder verwenden Sie /new, um neu zu beginnen.',
    it: 'Osservazione troppo lunga. Conferma con "conferma" o usa /new per ricominciare.',
    nl: 'Observatie te lang. Bevestig met "bevestigen" of gebruik /new om opnieuw te beginnen.',
  },
  greeting: {
    en: 'Hello! I can help you record medical equipment observations. Tell me what you saw at the hospital.',
    es: '¡Hola! Puedo ayudarte a registrar observaciones de equipo médico. Cuéntame qué viste en el hospital.',
    pt: 'Olá! Posso ajudá-lo a registrar observações de equipamento médico. Conte o que viu no hospital.',
    fr: "Bonjour! Je peux vous aider à enregistrer des observations d'équipement médical. Dites-moi ce que vous avez vu à l'hôpital.",
    de: 'Hallo! Ich kann Ihnen helfen, Beobachtungen von medizinischen Geräten zu erfassen. Erzählen Sie mir, was Sie im Krankenhaus gesehen haben.',
    it: 'Ciao! Posso aiutarti a registrare le osservazioni sui dispositivi medici. Raccontami cosa hai visto in ospedale.',
    nl: 'Hallo! Ik kan u helpen medische apparatuur observaties vast te leggen. Vertel me wat u in het ziekenhuis heeft gezien.',
  },
  noEquipmentGuidance: {
    en: 'I didn\'t find any medical equipment in your message. Try describing what you saw, for example: "I saw two MRI systems and one CT scanner at Hospital Central."',
    es: 'No encontré equipo médico en tu mensaje. Intenta describir lo que viste, por ejemplo: "Vi dos resonadores magnéticos y un tomógrafo en el Hospital Central."',
    pt: 'Não encontrei equipamento médico na sua mensagem. Tente descrever o que viu, por exemplo: "Vi dois sistemas de ressonância magnética e um tomógrafo no Hospital Central."',
    fr: "Je n'ai trouvé aucun équipement médical dans votre message. Essayez de décrire ce que vous avez vu, par exemple: \"J'ai vu deux IRM et un scanner à l'hôpital Central.\"",
    de: 'Ich habe keine medizinischen Geräte in Ihrer Nachricht gefunden. Versuchen Sie zu beschreiben, was Sie gesehen haben, zum Beispiel: "Ich habe zwei MRT-Geräte und ein CT-Gerät im Krankenhaus Central gesehen."',
    it: 'Non ho trovato dispositivi medici nel tuo messaggio. Prova a descrivere cosa hai visto, per esempio: "Ho visto due risonanze magnetiche e un tomografo all\'ospedale Central."',
    nl: 'Ik heb geen medische apparaten in uw bericht gevonden. Probeer te beschermen wat u heeft gezien, bijvoorbeeld: "Ik heb twee MRI-systemen en een CT-scanner gezien in het Ziekenhuis Central."',
  },
  simpleResponseGuidance: {
    en: 'I need a bit more detail. Could you describe the medical equipment you observed? For example: "I saw two MRI systems and one CT scanner at Hospital Central."',
    es: 'Necesito un poco más de detalle. ¿Podrías describir el equipo médico que observaste? Por ejemplo: "Vi dos resonadores magnéticos y un tomógrafo en el Hospital Central."',
    pt: 'Preciso de um pouco mais de detalhe. Você poderia descrever o equipamento médico que observou? Por exemplo: "Vi dois sistemas de ressonância magnética e um tomógrafo no Hospital Central."',
    fr: "J'ai besoin de plus de détails. Pourriez-vous décrire l'équipement médical que vous avez observé? Par exemple: \"J'ai vu deux IRM et un scanner à l'hôpital Central.\"",
    de: 'Ich brauche etwas mehr Detail. Könnten Sie die medizinischen Geräte beschreiben, die Sie beobachtet haben? Zum Beispiel: "Ich habe zwei MRT-Geräte und ein CT-Gerät im Krankenhaus Central gesehen."',
    it: 'Ho bisogno di un po\' più di dettaglio. Potresti descrivere i dispositivi medici che hai osservato? Per esempio: "Ho visto due risonanze magnetiche e un tomografo all\'ospedale Central."',
    nl: 'Ik heb iets meer details nodig. Kunt u de medische apparaten beschermen die u heeft waargenomen? Bijvoorbeeld: "Ik heb twee MRI-systemen en een CT-scanner gezien in het Ziekenhuis Central."',
  },
}

function msg(key: string, lang: Lang): string {
  const entry = M[key]
  return entry ? (entry[lang] ?? entry.en) : ''
}

function fill(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [k, v] of Object.entries(vars)) result = result.replaceAll(`{${k}}`, v)
  return result
}

// ─── Public message builders ───────────────────────────────────────────────────

export function msgIdentifiedEquipment(summary: string, location: string, lang: Lang): string {
  return fill(msg('identified', lang), { summary, location })
}

export function msgFollowUpIntro(lang: Lang): string {
  return msg('followUpIntro', lang)
}

export function msgReadyToSave(lang: Lang): string {
  return msg('readyToSave', lang)
}

export function msgNoEquipment(lang: Lang): string {
  return msg('noEquipment', lang)
}

export function msgNeedLocation(lang: Lang): string {
  return msg('needLocation', lang)
}

export function msgNeedQuantity(modLabel: string, lang: Lang): string {
  return fill(msg('needQuantity', lang), { mod: modLabel })
}

export function msgSaved(status: string, lang: Lang): string {
  return fill(msg('saved', lang), { status })
}

export function msgDraftDiscarded(lang: Lang): string {
  return msg('draftDiscarded', lang)
}

export function msgNoPending(lang: Lang): string {
  return msg('noPending', lang)
}

export function msgDuplicateWarning(lang: Lang): string {
  return msg('duplicateWarning', lang)
}

export function msgAlreadySaved(lang: Lang): string {
  return msg('alreadySaved', lang)
}

export function msgTooLong(lang: Lang): string {
  return msg('tooLong', lang)
}

export function msgGreeting(lang: Lang): string {
  return msg('greeting', lang)
}

export function msgNoEquipmentGuidance(lang: Lang): string {
  return msg('noEquipmentGuidance', lang)
}

export function msgSimpleResponseGuidance(lang: Lang): string {
  return msg('simpleResponseGuidance', lang)
}

// ─── Summary builder ──────────────────────────────────────────────────────────

export function buildEquipmentSummary(
  equipment: Array<{ quantity: number; modality: string }>,
  lang: Lang,
): string {
  return equipment.map(e => {
    const label = modalityLabelPlural(e.modality, e.quantity, lang)
    return `${e.quantity}× ${label}`
  }).join(', ')
}

export function buildCustomerLocation(
  name: string, city: string, country: string, _lang: Lang,
): string {
  return `${name}, ${city}, ${country}`
}
