# AGENTS.md — FieldSight

Guía de trabajo para agentes de IA y colaboradores humanos en este repositorio.
Léelo completo antes de tocar código.

## Qué es esto

**FieldSight** convierte observaciones de campo de ingenieros (visitas a hospitales)
en una base estructurada de equipos instalados, usando **IA 100% local** (QVAC).
Reto de Philips del "IA Hackathon powered by Tether".

### Regla de oro (obligatoria)

**NO usar servicios de IA en la nube para la inferencia.** Toda extracción, voz y
embeddings corre en el dispositivo vía `@qvac/sdk`. Cualquier llamada a una API de
IA externa descalifica la entrega ante ISD. Esto se verifica antes de pasar a Philips.

## Stack

- **TypeScript / Node.js** ≥ 22.17 (ESM, `"type": "module"`), npm ≥ 10.9
- **@qvac/sdk** 0.19 — worker local (Vulkan/CPU), descarga modelos del registry QVAC
- **better-sqlite3** — almacén local
- **tsx** para ejecución directa de `.ts`, **vitest** para tests, **tsc** para typecheck

## Primeros pasos (setup)

```bash
npm install
npm run seed          # carga el dataset dummy de Philips (20 obs, 13 clientes)
npm test              # 18 tests
npm run typecheck     # tsc --noEmit
npm run cli           # asistente conversacional (descarga Qwen3-4B en el 1er uso)
npm run server        # dashboard web → http://localhost:4173
```

### Probar la IA local en una máquina sin GPU (o rápido)

```bash
FIELDSIGHT_EXTRACT_MODEL=small npm run cli      # usa Qwen3-0.6B (~382MB) ya cacheado
node --import tsx scripts/smoke-extract.ts      # smoke test end-to-end con modelo real
```

En la máquina con GPU (NVIDIA/AMD + Vulkan) usa el modelo por defecto `QWEN3_4B_INST_Q4_K_M`.

## Estructura

```
src/
  extract/prompt.ts    # prompt + JSON Schema de extracción (NO duplicar: editar aquí)
  extract/extractor.ts # carga de modelo y llamadas completion() con QVAC
  agent/agent.ts       # lógica conversacional: follow-ups, duplicados, estados, guardado
  store/db.ts          # SQLite: customers, observations, equipment
  store/seed.ts        # seed desde data/dummy_installed_base.json
  insights/insights.ts # Customer 360, global stats, NL analytics
  evidence/logger.ts   # log auditable JSONL + export CSV
  voice/transcribe.ts  # STT on-device (Whisper vía QVAC)
  cli.ts               # asistente por terminal
  server.ts            # API del dashboard
  server/index.html    # dashboard (diseño "film sheet", ver skill frontend-design)
tests/                 # vitest (agent + insights)
scripts/               # smoke-extract, voice-capture, convert-xlsx, security-local
docs/                  # brief original de Philips
data/                  # dataset dummy (xlsx + json) — la .db NO se versiona
evidence/              # logs generados — NO se versionan (.gitignore)
```

## Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | CLI con watch (tsx watch) |
| `npm run cli` | Asistente conversacional |
| `npm run server` | Dashboard web (PORT env para cambiar puerto) |
| `npm test` | Tests unitarios (vitest) |
| `npm run typecheck` | TypeScript estricto |
| `npm run security:sca` | `npm audit` |
| `scripts/security-local.sh` | Gates locales: typecheck + gitleaks + audit |

Comandos dentro del CLI: `/help`, `/dashboard`, `/customers`, `/query <nl>`,
`/evidence` (exporta CSV), `/exit`.

## Modelo de datos

- `customers` — cliente/facilidad + ciudad + país (unique name+city+country)
- `observations` — quién reportó, cuándo, texto original, fuente (Voice/Text/Photo)
- `equipment` — fila por modalidad: modality, quantity, brand, model, age (min/max/qualitative),
  installation_year, status, confidence

**Status por observación** (del brief de Philips): `Confirmed | Reported | Estimated | Unknown`.
`Confirmed` solo tras confirmación explícita del usuario; edad estimada → `Estimated`;
lo desconocido va como `Unknown` (nunca inventado).

## Convenciones de código

1. **Tipos**: módulos importan tipos con `import type`. `strict` + `noUncheckedIndexedAccess`
   activos — indexar arrays devuelve `T | undefined`, usar `?? 0` / guardas.
2. **ModelId** es `string` (lo que devuelve `loadModel`). No importar `ModelId` del SDK (no existe).
3. **Métricas QVAC**: los stats de `completion()` son `CompletionStats` (campos: `timeToFirstToken`,
   `tokensPerSecond`, `promptTokens`, `generatedTokens`, `backendDevice`). Usar ese tipo, no casts.
4. **Schema de extracción**: vive en `src/extract/prompt.ts`. Si cambias el contrato,
   actualiza también `src/types.ts` (`Extraction`) y los tests.
5. **Anti-alucinación**: `filterModalitiesMentioned()` descarta equipos que el modelo inventó.
   No eliminar esta defensa; el modelo pequeño alucina.
6. **Sin código muerto**: si un módulo/import deja de usarse, elimínalo (ver skill code-review).
7. **Sin comentarios innecesarios**; los que existan explican "por qué", no "qué".
8. **Evidence**: cada load/inferencia/unload debe loguearse en `logEvidence()` — es la prueba
   auditable de que la inferencia fue local.

## Tests (TDD)

- Tests por comportamiento a través de interfaces públicas, no internals.
- **Prohibido tests tautológicos** (esperado que recalcula igual que el código): usar literales
  independientes.
- Tests de DB usan `openDb(':memory:')`; el seed acepta una DB inyectada.
- Para añadir una feature: red → green → refactor (skill `tdd`).

## Flujo de colaboración

1. Crear rama por feature: `git checkout -b feat/<nombre>`
2. Escribir test (rojo) → implementar (verde) → refactor
3. `npm run typecheck && npm test` local antes de subir
4. Push y abrir PR contra `main`
5. CI corre gates: TruffleHog (secrets), Semgrep (SAST), `npm audit`, typecheck, tests

## Seguridad

- Nunca committear secretos. Variables en `.env` (ver `.env.example`).
- `xlsx` NO es dependencia de producción (vuln sin fix GHSA-4r6h-8v6p-xvw6):
  el dataset se pre-convierte a JSON con `scripts/convert-xlsx.mjs` en build-time.
- `.gitignore` excluye: `.env`, `data/*.db*`, `evidence/`, `node_modules/`, `.qvac/`.

## Ambiente de runtime

- La GPU real es una máquina remota (NVIDIA/AMD, Vulkan ≥ 1.4). Este WSL es solo desarrollo.
- Requisitos QVAC en Linux: `g++ ≥ 13`, Vulkan runtime ≥ 1.4, usuario en grupos `render`,`video`.
- Modelos se cachean en `~/.qvac/models/` (multi-GB). No borrar salvo liberar espacio.

## Preguntas frecuentes

- **¿Dónde cambio el modelo de extracción?** `EXTRACTION_MODEL` en `src/extract/extractor.ts`.
  Acepta constantes del registry o rutas `.gguf` locales.
- **¿La IA usa internet?** Solo para descargar modelos del registry QVAC al primer uso.
  La inferencia es 100% local/offline.
- **¿Cómo pruebo sin GPU?** `FIELDSIGHT_EXTRACT_MODEL=small` (Qwen3-0.6B) o `scripts/smoke-extract.ts`.