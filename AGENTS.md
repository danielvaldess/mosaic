# AGENTS.md — Mosaic

Mosaic captura observaciones de campo de ingenieros y las convierte en una base
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
npm run model:fetch    # trae el Qwen3-1.7B a assets/models (offline installer)
npm run desktop:dist   # instalador NSIS → release/Mosaic-Setup-<version>.exe
npm run desktop:dist:offline # igual pero forzando model:fetch antes
npm run test:e2e       # build + Playwright sobre la app Electron (stub LLM local)
```

**En máquinas sin GPU / demos rápidas**, usa el modelo chico:

```bash
MOSAIC_EXTRACT_MODEL=small npm run cli   # Qwen3-0.6B (~382MB)
MOSAIC_EXTRACT_MODEL=small npm run web   # misma opción para web
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
src/settings.ts           ← perfil persistido (nombre, idioma, ubicación) en data/settings.json
src/cli.ts                ← asistente por terminal (entry point principal)
src/web-server.ts         ← servidor web con chat IA (API /api/chat, /api/followup, /api/suggestions)
src/web/chat.html         ← interfaz de chat: language selector + suggestion chips
src/web/onboarding.html   ← primera ejecución: idioma (EN/ES), nombre y ubicación GPS
src/server.ts             ← dashboard solo-lectura (sin IA)
src/server/index.html     ← HTML del dashboard
src/electron/main.ts      ← shell Electron: ventana, arranque del server, single-instance, rutas de usuario
src/electron/security.ts  ← CSP por sesión, navigation guards, permisos denegados
src/electron/updates.ts   ← electron-updater contra GitHub Releases (check manual por defecto)
src/electron/logging.ts   ← electron-log (userData/logs) + captura de crashes
src/electron/preload.cts  ← contextBridge para la pantalla de carga (IPC de progreso)
src/electron/loading.html ← splash con progreso de descarga del modelo
e2e/app.spec.ts           ← E2E Playwright con stub OpenAI-compatible (sin modelo real)
playwright.config.ts      ← config E2E (workers=1 por el single-instance)
vitest.config.ts          ← limita vitest a tests/** (excluye e2e/)
.github/workflows/release-desktop.yml ← tag v* → instalador + draft release
.github/workflows/desktop-e2e.yml     ← E2E en PRs que tocan src/ o el empaquetado
electron-builder.yml      ← config NSIS (asar off, poda de prebuilds no-win32-x64)
tsconfig.build.json       ← build de producción (solo src/ → dist/)
scripts/copy-static.mjs   ← copia chat/dashboard/loading a dist/
scripts/fetch-model.mjs   ← descarga/verifica el .gguf bundleado (assets/models, gitignored)
scripts/build-desktop.mjs ← build del instalador (--offline fuerza el modelo)
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

### Detección de intents multilíngüe (`detectFollowUpIntent`)
- Regex multiidioma para detectar la intención de una pregunta de follow-up (una sola intención)
- Marca: brand/marca/marque/hersteller/merk, Edad: age/old/años/ans/jahre/etc.
- El web manda `intent` y `modality` en el body de `/api/chat` (opcionales); el servidor
  cae al regex si no vienen (CLI y tests no los mandan)

## Validación contra el dataset (`src/agent/dataset-match.ts`)

El chat está enfocado al vocabulario del installed base: marcas, modelos y hospitales
que existen en la DB. `matchDataset()` compara con normalización de acentos/caso y
distancia de Levenshtein (tolerancia a typos), más reglas de abreviatura
("aurelia" → "Aurelia Health", "DemoCare Pacific" → "Hospital DemoCare Pacific").

- **Respuestas de follow-up** (brand/model/customer): en `Conversation.turn()` antes de
  inferir. Exacto → se canoniza a la grafía del dataset; cercano → reply con
  `suggestions` + `suggestionQuestion/Intent/Modality` (chips en el frontend, sin gastar
  GPU); inválido → se rechaza y se ofrecen las opciones más cercanas. Si la DB no tiene
  vocabulario (instalación limpia) la validación se saltea para no bloquear.
- **Extracción del LLM**: `alignWithDataset()` descarta brand/model inventados que no
  existen en la DB (vuelve a preguntar con opciones válidas) y canoniza near-matches.
  El nombre del hospital solo se canoniza, nunca se descarta (así se agregan hospitales nuevos).
- **"No sé"** (`isUnknownAnswer`): declina el campo sin guardarlo y no se vuelve a preguntar
  (`this.declined`, se limpia en `reset()`).
- Umbral close = 0.72; sugerencias ordenadas por score (máx 5).
- La validación NO aplica a age/quantity (parseo numérico) ni a notes/location (texto libre).

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
- **Rutas de usuario en desktop**: `main.ts` fija `MOSAIC_DATA_DIR`, `MOSAIC_EVIDENCE_DIR`,
  `MOSAIC_SEED_PATH` y `QVAC_CONFIG_PATH` ANTES de importar los módulos (se leen al import).
  La DB vive en `%APPDATA%\Mosaic\data` y el dummy se siembra en el primer arranque.
- **Primer arranque**: `loadExtractionModel()` sube `QVAC_RPC_INIT_TIMEOUT_MS` a 180s porque el
  escaneo de antivirus del runtime `bare` puede superar el default de 30s.
- **Electron 44** no corre postinstall: el binario se descarga lazy al primer `require('electron')`
  (o `node node_modules/electron/install.js`). Sin eso, `npm run desktop` falla en un clon limpio.
- **electron-builder 26**: `publisherName` ya no existe en `win` (migrado a `signtoolOptions`);
  el schema usa `additionalProperties: false`, cualquier clave extra rompe el build.
- **Seguridad desktop**: CSP se inyecta por `onHeadersReceived` en `security.ts` (no tocar sin
  probar el chat: usa `'unsafe-inline'` porque chat.html tiene `<script>`/`<style>` inline).
  `will-navigate` solo permite el origen local; links externos solo http/https vía `shell.openExternal`.
  Permisos del renderer denegados por defecto. DevTools solo en dev (`app.isPackaged`).
  El micrófono (`media`) está permitido SOLO para el origen local (voz on-device).
- **Sin ventanas de consola**: `hide-child-windows.ts` parchea `child_process` (spawn/exec/fork)
  con `windowsHide: true` al importarse ANTES que el SDK. Sin eso, el worker `bare.exe`
  (binario de consola) y el chequeo de firma de `electron-updater` abren ventanas CMD.
  No quitar ese import de `main.ts` ni reordenarlo.
- **Auto-update**: `electron-updater` se importa con `createRequire` porque el import ESM named
  falla; el check es MANUAL por defecto (menú Help) para no romper la regla de red del hackathon.
  `MOSAIC_AUTO_UPDATE=1` lo activa al arrancar. `app-update.yml` lo genera electron-builder.
  Repo privado: requiere release publicado (no draft) y visibilidad/token para actualizar.
- **Logs desktop**: electron-log escribe `%APPDATA%\Mosaic\logs\main.log`; el menú File/Help
  abre la carpeta. Los crashes del renderer muestran diálogo y quedan en el log.
- **Onboarding (primera ejecución)**: `main.ts` decide entre `/onboarding` y `/` según
  `onboardingComplete` en `settings.json`. Pasos: idioma (solo EN/ES) → nombre → ubicación
  (GPS con fallback manual). El idioma queda bloqueado para SIEMPRE en todas las
  conversaciones y el nombre se usa como `observer`. El chat oculta el selector de idioma
  y saluda por nombre.
- **Modelo lazy**: `startMosaicServer()` ya no espera al modelo; `createInference()` corre en
  background y `/api/ready` reporta `{ ready, progress }`. La primera inferencia espera.
  El splash usa `mosaic-logo.png` (copiado a dist/electron y dist/web).
- **Solo EN/ES en desktop**: el backend i18n conserva los 7 idiomas (web/CLI), pero el
  desktop ofrece y bloquea únicamente `en`/`es`.
- **Modelo bundleado**: `main.ts` setea `MOSAIC_MODEL_PATH` al `.gguf` de `resources/models/`
  si existe; `loadExtractionModel()` lo carga con `modelSrc: <path>, modelType: 'llamacpp-completion'`.
  Sin bundle cae al descriptor del registry. `assets/models/*.gguf` está gitignored.
- **Límite NSIS**: los instaladores NSIS no pueden superar ~2 GB, por eso se bundlea el
  Qwen3-1.7B (~1 GB) y no el 4B (~2.5 GB). El instalador offline queda en ~1.2 GB.
- **Filtro de modalidades**: `mentions()` es accent-insensitive y acepta plurales; sin eso
  "resonadores magneticos" / "tomografo" se descartaban (ver test en `tests/grounding.test.ts`).
- **E2E**: Playwright lanza la app con `MOSAIC_LLM_URL` apuntando a un stub HTTP local,
  así no descarga modelo. `MOSAIC_USER_DATA_DIR` (env) aisla la DB/evidencia del test
  y permite modo portable.
- **CI desktop**: release-desktop.yml se dispara con tags `v*` y publica draft en GitHub Releases;
  desktop-e2e.yml corre Playwright en windows-latest (descarga el binario de Electron antes).

## Convenciones

- `import type` para tipos; `noUncheckedIndexedAccess` activo → `arr[i]` es `T | undefined`.
- Sin tests tautológicos: literales independientes del código.
- Sin código muerto: eliminar módulos/imports sin uso.
- Comentarios solo explican "por qué", no "qué".
- Cada load/inferencia/unload debe loguearse con `logEvidence()`.

## Env vars

- `MOSAIC_EXTRACT_MODEL=small` — Qwen3-0.6B en vez del 4B por defecto
- `MOSAIC_AUTOSAVE=1` — guarda sin confirmación
- `MOSAIC_OBSERVER` — identidad del observador (default "Field User 01")
- `PORT` — puerto del servidor (default: 4173 server, 4174 web)
- `QVAC_CPU_ONLY=1` — forzar inferencia CPU sin Vulkan
- `MOSAIC_DATA_DIR` — carpeta de la DB (default `cwd/data`; desktop → `%APPDATA%\Mosaic\data`)
- `MOSAIC_EVIDENCE_DIR` — carpeta del log auditable (default `cwd/evidence`)
- `MOSAIC_SEED_PATH` — JSON del dataset dummy para el seed automático
- `MOSAIC_AUTO_UPDATE=1` — chequea updates al arrancar (default: solo manual desde el menú Help)
- `MOSAIC_USER_DATA_DIR` — override de userData (tests E2E / modo portable)
- `MOSAIC_MODEL_PATH` — ruta a un `.gguf` local (la setea el desktop para el modelo bundleado)
- `QVAC_CONFIG_PATH` — ruta explícita a `qvac.config.json`
- `QVAC_RPC_INIT_TIMEOUT_MS` — timeout del handshake del worker (default SDK 30s; `loadExtractionModel` lo sube a 180s)
- `.env.example` documenta; nunca committear `.env`

> **Decisión del equipo: inferencia FULL LOCAL.** Cada máquina corre el modelo
> con su propio hardware (GPU vía Vulkan, o CPU como fallback automático). El
> modo de delegación remota (MOSAIC_LLM_URL/MODEL/API_KEY y
> `config/qvac.serve.json`) quedó implementado y verificado en
> `src/extract/remote.ts`, pero NO es el camino actual — se mantiene solo como
> referencia/opción futura. No introducir dependencia de un server remoto en la
> demo: la app debe funcionar sin configuración extra en cualquier máquina.

## API Endpoints

- `POST /api/chat` — conversación principal (accepts `lang`, `intent` and `modality` for follow-up answers)
- `POST /api/followup` — follow-up directo
- `GET/POST /api/settings` — perfil de primera ejecución (nombre, idioma, ubicación)
- `GET /api/ready` — estado de carga del modelo `{ ready, progress }`
- `GET /onboarding` — página de primera ejecución (solo desktop)
- `GET /mosaic-logo.png` — logo servido para landing/onboarding
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
