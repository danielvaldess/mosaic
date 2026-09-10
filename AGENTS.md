# AGENTS.md — FieldSight

FieldSight captura observaciones de campo de ingenieros y las convierte en una base
estructurada de equipos médicos instalados, con IA **100% local** vía `@qvac/sdk`.

## Regla de oro

**Toda inferencia debe correr on-device vía QVAC.** Nada de APIs de IA en la nube —
descalifica la entrega ante ISD. El único tráfico de red permitido es la descarga de
modelos del registry QVAC al primer uso (se cachean en `~/.qvac/models/`).

## Comandos

```bash
npm install            # requiere Node >=22.17 (ESM, "type":"module")
npm run seed           # carga data/dummy_installed_base.json (20 obs, 13 clientes)
npm run typecheck      # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm test               # vitest run
npm run cli            # asistente conversacional por terminal
npm run web            # chat web con IA → http://localhost:4174
npm run server         # dashboard solo-lectura → http://localhost:4173
npm run build          # compila src/ → dist/ (tsc) + copia HTML estáticos
npm run desktop        # app Electron en dev (requiere build previo)
npm run desktop:pack   # app empaquetada sin instalador → release/win-unpacked/
npm run desktop:dist   # instalador NSIS → release/FieldSight-Setup-<version>.exe
```

**En máquinas sin GPU / demos rápidas**, usa el modelo chico:

```bash
FIELDSIGHT_EXTRACT_MODEL=small npm run cli   # Qwen3-0.6B (~382MB)
FIELDSIGHT_EXTRACT_MODEL=small npm run web   # misma opción para web
node --import tsx scripts/smoke-extract.ts   # smoke test end-to-end
```

Sin `small`, se descarga Qwen3-4B (~2.5GB) — no lo lances por accidente en CI.

**No hay `npm run lint`** (eslint no está configurado). La verificación es
`npm run typecheck && npm test`. CI gates: TruffleHog + Semgrep + `npm audit` + typecheck + test.

## Estructura

```
src/extract/prompt.ts     ← prompt + JSON Schema. ÚNICA fuente del contrato LLM.
src/extract/extractor.ts  ← loadModel + completion() con responseFormat json_schema
src/extract/remote.ts     ← remote inference (opcional, no usado en la demo full-local)
src/extract/provider.ts   ← entrypoint unificado (default: local on-device)
src/agent/agent.ts        ← follow-ups, duplicados, estados, guardado, anti-alucinación
src/agent/conversation.ts ← turn handling, language locking, follow-up answer application
src/agent/i18n.ts         ← 7-language i18n: detection, modality labels, plurals, follow-ups
src/store/db.ts           ← SQLite (better-sqlite3); snake_case DB → camelCase TS; getChatSuggestions()
src/store/seed.ts         ← carga del dataset dummy (acepta DB inyectada para tests)
src/insights/insights.ts  ← Customer 360, stats globales, NL analytics determinista
src/evidence/logger.ts    ← log auditable (evidence/evidence.jsonl) + export CSV
src/voice/transcribe.ts   ← STT Whisper on-device
src/types.ts              ← tipos, MODALITIES, BRANDS, STATUSES, CONFIDENCES
src/cli.ts                ← asistente por terminal (entry point principal)
src/web-server.ts         ← servidor web con chat IA (API /api/chat, /api/followup, /api/suggestions)
src/web/chat.html         ← interfaz de chat: language selector + suggestion chips
src/server.ts             ← dashboard solo-lectura (sin IA)
src/server/index.html     ← HTML del dashboard
src/electron/main.ts      ← shell Electron: ventana, arranque del server, single-instance, rutas de usuario
src/electron/preload.cts  ← contextBridge para la pantalla de carga (IPC de progreso)
src/electron/loading.html ← splash con progreso de descarga del modelo
electron-builder.yml      ← config NSIS (asar off, poda de prebuilds no-win32-x64)
tsconfig.build.json       ← build de producción (solo src/ → dist/)
scripts/copy-static.mjs   ← copia chat/dashboard/loading a dist/
scripts/png-to-ico.mjs    ← PNG 256x256 → build/icon.ico
scripts/smoke-extract.ts  ← smoke test con modelo real
scripts/convert-xlsx.mjs  ← conversor XLSX→JSON (one-time)
scripts/voice-capture.mjs ← demo de transcripción WAV
```

Flujo: texto → `extractObservation()` → `handleObservation()` (follow-ups, duplicados,
estados) → `insertObservation()` → insights.

### Suggestion Chips (chat web)
- El input de texto se oculta cuando hay chips de sugerencias disponibles
- Chips se cargan desde `/api/suggestions` (reales de la DB) con fallback hardcodeado
- `getChatSuggestions(db)` en `db.ts` consulta marcas, modelos, hospitales y ciudades únicos
- `getSuggestions(followUp, observation)` en `chat.html` selecciona chips por intención
- Cuando no hay sugerencias para una intención, se muestra el input de texto normal

## i18n (Multiidioma)

Soporte completo para 7 idiomas: en, es, pt, fr, de, it, nl.

### Selector de idioma (chat web)
- Al iniciar el chat, el usuario debe seleccionar entre **Español** o **English**
- El idioma se bloquea para toda la conversación (`setLockedLanguage()` en `Conversation`)
- El servidor recibe `lang` en el request y lo bloquea al crear la sesión
- La detección automática de idioma se desactiva cuando hay idioma bloqueado
- No se puede enviar mensaje sin seleccionar idioma primero

### Detección de idioma (`src/agent/i18n.ts`)
- Detección por palabras clave con pesos (no regex única)
- Detección rápida de saludos (<20 chars): "Hola"→es, "Hello"→en, "Olá"→pt, etc.
- Palabras compartidas entre idiomas (el/la/en/de) cuentan por ocurrencia
- `handleObservation` recibe `lang` como parámetro para evitar re-detección desde el transcript

### Etiquetas de modalidad
- Cada modality tiene labels en 7 idiomas (MR, CT, Ultrasound, X-Ray, etc.)
- Plurales automáticos: resonadores magnéticos, resonateurs magnétiques, MRT-Geräte, etc.

### Preguntas de follow-up
- Templates por idioma para brand, model, age, quantity, customer, location, notes
- Cada pregunta incluye razón (ej: "Knowing the manufacturer helps track equipment lifecycle")

### Detección de intents multilíngüe (`applyFollowUpAnswer`)
- Regex multiidioma para detectar intención de la pregunta (no solo keywords en inglés)
- Marca: brand/marca/marque/hersteller/merk, Edad: age/old/años/ans/jahre/etc.

## Mejoras en la conversación

### Respuestas simples
- Saludos ("Hola", "Hello") → retorna mensaje de bienvenida en el idioma detectado
- Respuestas cortas ("no", "sí", "no sé") sin draft activo → retorna guía

### Mensajes de guía
- Cuando no detecta equipo: "No encontré equipo médico... Intenta describir: 'Vi dos resonadores magnéticos y un tomógrafo'"
- En 7 idiomas con ejemplos específicos

### Extracción multilíngüe (`src/extract/prompt.ts`)
- Prompt incluye sinónimos de modalidad en 7 idiomas
- resonador magnético/resonancia magnética = MR, tomógrafo = CT, ecógrafo = Ultrasound, etc.

## Normalización de clientes (`src/store/db.ts`)

- `findOrCreateCustomer` normaliza acentos con `normalizeAccents()` (NFD + strip)
- Evita duplicados: "Panama" y "Panamá" se tratan como el mismo país
- customers son unique por (name+city+country) case-insensitive + accent-normalized

## Quirks que rompen a los agentes

- **`loadModel` devuelve `string`**, no `ModelId`. No lo importes.
- **`CompletionStats`** usa `timeToFirstToken`, `generatedTokens`, `tokensPerSecond`,
  `backendDevice` — NO `ttftMs`/`outputTokens`. Importa el tipo, no hagas casts.
- **Unión de descriptors** en `modelSrc` rompe overloads de `loadModel`. Castea
  `as typeof QWEN3_4B_INST_Q4_K_M` (ver `extractor.ts:81`).
- **`normalizeModality`** devuelve `undefined` para modalidades no reconocidas.
  **`filterModalitiesMentioned()`** descarta equipos inventados por el modelo. No eliminar esa defensa.
- **DB mappings**: filas snake_case (`customer_id`, `age_min`); tipos camelCase.
  Usar `mapCustomer`, `mapEquipment`, `mapObservation` de `db.ts`.
- **`seedFromXlsx()`** acepta DB inyectada para tests. Tests usan `openDb(':memory:')`.
- **Query de edad por filas, no promedios**: `queryInstalledBase` evalúa equipos
  individualmente ("2 MR viejos + 1 nuevo" matchea "MR >7 años").
- **Language locking**: `Conversation.setLockedLanguage()` debe llamarse ANTES del primer `turn()`.
  El `lang` en el request body se aplica solo al crear la sesión, no en sesiones existentes.
- **Suggestion chips**: el input se oculta cuando hay chips. Si el usuario necesita escribir
  algo que no está en los chips, debe usar "Otro..." o esperar a que no haya chips.
- **Empaquetado desktop**: `asar: false` es obligatorio — el worker `bare` del SDK no puede
  leer dentro de un asar. `npmRebuild: false` porque better-sqlite3 v13 trae prebuilds N-API.
  `files` poda `prebuilds/` de otras plataformas (android/ios/darwin/linux/win32-arm64).
- **Rutas de usuario en desktop**: `main.ts` fija `FIELDSIGHT_DATA_DIR`, `FIELDSIGHT_EVIDENCE_DIR`,
  `FIELDSIGHT_SEED_PATH` y `QVAC_CONFIG_PATH` ANTES de importar los módulos (se leen al import).
  La DB vive en `%APPDATA%\FieldSight\data` y el dummy se siembra en el primer arranque.
- **Primer arranque**: `loadExtractionModel()` sube `QVAC_RPC_INIT_TIMEOUT_MS` a 180s porque el
  escaneo de antivirus del runtime `bare` puede superar el default de 30s.
- **Electron 44** no corre postinstall: el binario se descarga lazy al primer `require('electron')`
  (o `node node_modules/electron/install.js`). Sin eso, `npm run desktop` falla en un clon limpio.
- **electron-builder 26**: `publisherName` ya no existe en `win` (migrado a `signtoolOptions`);
  el schema usa `additionalProperties: false`, cualquier clave extra rompe el build.

## Convenciones

- `import type` para tipos; `noUncheckedIndexedAccess` activo → `arr[i]` es `T | undefined`.
- Sin tests tautológicos: literales independientes del código.
- Sin código muerto: eliminar módulos/imports sin uso.
- Comentarios solo explican "por qué", no "qué".
- Cada load/inferencia/unload debe loguearse con `logEvidence()`.

## Env vars

- `FIELDSIGHT_EXTRACT_MODEL=small` — Qwen3-0.6B en vez del 4B por defecto
- `FIELDSIGHT_AUTOSAVE=1` — guarda sin confirmación
- `FIELDSIGHT_OBSERVER` — identidad del observador (default "Field User 01")
- `PORT` — puerto del servidor (default: 4173 server, 4174 web)
- `QVAC_CPU_ONLY=1` — forzar inferencia CPU sin Vulkan
- `FIELDSIGHT_DATA_DIR` — carpeta de la DB (default `cwd/data`; desktop → `%APPDATA%\FieldSight\data`)
- `FIELDSIGHT_EVIDENCE_DIR` — carpeta del log auditable (default `cwd/evidence`)
- `FIELDSIGHT_SEED_PATH` — JSON del dataset dummy para el seed automático
- `QVAC_CONFIG_PATH` — ruta explícita a `qvac.config.json`
- `QVAC_RPC_INIT_TIMEOUT_MS` — timeout del handshake del worker (default SDK 30s; `loadExtractionModel` lo sube a 180s)
- `.env.example` documenta; nunca committear `.env`

> **Decisión del equipo: inferencia FULL LOCAL.** Cada máquina corre el modelo
> con su propio hardware (GPU vía Vulkan, o CPU como fallback automático). El
> modo de delegación remota (FIELDSIGHT_LLM_URL/MODEL/API_KEY y
> `config/qvac.serve.json`) quedó implementado y verificado en
> `src/extract/remote.ts`, pero NO es el camino actual — se mantiene solo como
> referencia/opción futura. No introducir dependencia de un server remoto en la
> demo: la app debe funcionar sin configuración extra en cualquier máquina.

## API Endpoints

- `POST /api/chat` — conversación principal (accepts `lang` param for locked language)
- `POST /api/followup` — follow-up directo
- `GET /api/suggestions` — retorna marcas, modelos, hospitales y ciudades de la DB para chips
- `GET /api/stats` — estadísticas globales
- `GET /api/customers` — Customer 360 de todos los clientes
- `GET /api/customers/refresh` — candidatos para refrescar
- `GET /api/query?q=<texto>` — NL analytics determinista
- `GET /api/evidence` — exportar CSV de evidencia

**Regla**: local y remoto devuelven el mismo `Extraction` vía `src/extract/provider.ts`
(`createInference()`), así `Conversation` no sabe ni le importa el backend.

## Modelo de datos

- `customers` (unique name+city+country) · `observations` · `equipment` (fila por modalidad)
- **Status**: `Confirmed | Reported | Estimated | Unknown`
- **Confidence**: `High | Medium | Low`
- `Confirmed` solo tras confirmación explícita del usuario; edad estimada → `Estimated`

## Seguridad y CI

CI en `.github/workflows/security-gates.yml` (5 gates):
1. TruffleHog secret scan (historial completo)
2. Semgrep SAST (`p/security-audit`)
3. `npm audit` (high severity)
4. `tsc --noEmit`
5. `vitest run` (depende de typecheck)

Local: `scripts/security-local.sh` (typecheck + gitleaks + npm audit).
No subir dependencias sin pasar `npm audit`.

## Colaboración

Rama por feature (`feat/<nombre>`), `typecheck && test` antes de push, PR contra `main`.
