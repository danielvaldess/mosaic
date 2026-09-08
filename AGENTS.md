# AGENTS.md — FieldSight

FieldSight convierte observaciones de campo de ingenieros en una base estructurada
de equipos médicos instalados, con IA **100% local** vía `@qvac/sdk`. Reto Philips del
IA Hackathon powered by Tether.

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
npm run cli            # asistente conversacional (descarga Qwen3-4B ~2.5GB al 1er uso)
npm run server         # dashboard → http://localhost:4173  (PORT env para cambiar)
```

**En máquinas sin GPU / demos rápidas**, usa el modelo chico ya cacheado:

```bash
FIELDSIGHT_EXTRACT_MODEL=small npm run cli   # Qwen3-0.6B (~382MB)
node --import tsx scripts/smoke-extract.ts   # smoke test end-to-end con modelo real
```

Sin `small`, el CLI descarga 2.5GB y tarda minutos — no lo lances por accidente en CI o en el smoke.

**Nota**: no hay `npm run lint` (eslint no está configurado). La verificación es
`npm run typecheck && npm test`. Los gates de CI (`.github/workflows/security-gates.yml`)
corren TruffleHog + Semgrep + `npm audit` + typecheck + test — Semgrep/TruffleHog solo existen ahí.

## Estructura y flujo

```
src/extract/prompt.ts    ← prompt + JSON Schema de extracción. UNICA fuente del contrato.
src/extract/extractor.ts ← carga de modelo + completion() con responseFormat json_schema
src/agent/agent.ts       ← conversación: follow-ups, duplicados, estados, guardado, anti-alucinación
src/store/db.ts          ← SQLite (better-sqlite3); maps snake_case fila → camelCase tipo
src/insights/insights.ts ← Customer 360, stats globales, NL analytics determinista
src/evidence/logger.ts   ← log auditable (evidence/evidence.jsonl) + export CSV
src/voice/transcribe.ts  ← STT Whisper on-device
src/cli.ts               ← asistente por terminal (punto de entrada principal)
src/server.ts            ← API del dashboard (sirve src/server/index.html)
```

Flujo del agente: texto/voz → `extractObservation()` → `handleObservation()` (pregunta
por datos faltantes, confirma, detecta duplicados) → `insertObservation()` → insights.

## Quirks que rompen a los agentes

- **`loadModel` devuelve `string`**, no `ModelId` (ese tipo no existe en el SDK). No lo importes.
- **`CompletionStats`** (el tipo de `final.stats`) usa `timeToFirstToken`, `generatedTokens`,
  `tokensPerSecond`, `backendDevice` — NO `ttftMs`/`outputTokens`. Importa el tipo, no hagas casts.
- **Unión de descriptors** en `modelSrc` rompe la resolución de overloads de `loadModel`
  (elige whisper). Si alternas modelos, castea `as typeof QWEN3_4B_INST_Q4_K_M` (ver `extractor.ts:81`).
- **`normalizeModality`** devuelve `undefined` para modalidades no reconocidas — NO retornar el
  input crudo. Y **`filterModalitiesMentioned()`** descarta equipos que el modelo inventó (alucina).
  No eliminar esa defensa.
- **DB mappings**: las filas de SQLite son snake_case (`customer_id`, `age_min`); los tipos son
  camelCase. Usar los mappers de `db.ts` (`mapCustomer`, `mapEquipment`, `mapObservation`), no castear.
- **`seedFromXlsx()` acepta una DB inyectada** para tests; los tests de DB usan `openDb(':memory:')`.
- **Query de edad por filas, no promedios**: `queryInstalledBase` evalúa equipos viejos
  individualmente ("2 MR viejos + 1 nuevo" debe matchear "MR >7 años").

## Convenciones

- Tipos con `import type`; `noUncheckedIndexedAccess` activo → `arr[i]` es `T | undefined`, usa `?? 0`.
- Sin tests tautológicos (esperado que recalcula igual que el código): literales independientes.
- Sin código muerto: si un módulo/import queda sin uso, elimínalo.
- Comentarios solo explican "por qué", no "qué".
- Cada load/inferencia/unload debe loguearse con `logEvidence()` — es la prueba de inferencia local.

## Env vars

- `FIELDSIGHT_EXTRACT_MODEL=small` — usa Qwen3-0.6B en vez del 4B por defecto
- `FIELDSIGHT_AUTOSAVE=1` — guarda sin confirmación (modo no interactivo)
- `FIELDSIGHT_OBSERVER` — identidad del observador (default "Field User 01")
- `.env.example` documenta; nunca committear `.env`

## Modelo de datos

- `customers` (unique name+city+country) · `observations` · `equipment` (fila por modalidad)
- **Status**: `Confirmed | Reported | Estimated | Unknown`. `Confirmed` solo tras confirmación
  explícita del usuario; edad estimada → `Estimated`; lo desconocido → `Unknown` (nunca inventado).

## Colaboración

Rama por feature (`feat/<nombre>`), `typecheck && test` antes de push, PR contra `main`.
CI valida secrets/SAST/SCA/tests — no subir dependencias nuevas sin pasar `npm audit`.

## Referencias de contexto

- `README.md` — visión, pipeline, decisiones de diseño.
- `docs/Challenge_Brief.docx` — brief original de Philips (problema, MVP, stretch goals).
- Skill `frontend-design` (diseño del dashboard, estética "film sheet") y `tdd`/`code-review`
  para el flujo de desarrollo.