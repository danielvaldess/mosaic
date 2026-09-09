# FieldSight

**Customer Installed Base Intelligence** — transforma observaciones de campo en una vista viva, confiable y accionable de la base instalada de equipos médicos.

Hackathon Challenge de Philips · IA Hackathon powered by Tether (QVAC). Todo el razonamiento corre **localmente** con `@qvac/sdk` — sin cloud, sin API keys.

## ¿Qué resuelve?

Ingenieros de servicio y ventas visitan hospitales todos los días y ven resonadores (MR), tomógrafos (CT), ecógrafos (Ultrasound), etc. Esa información queda en notas o memoria. FieldSight permite capturar la observación **con una conversación** (texto o voz), extrae la estructura con IA local, hace preguntas cuando falta lo importante, detecta duplicados y construye un repositorio estructurado por cliente y geografía.

## Pipeline

```
Captura (texto/voz)
   → Extracción LLM local con JSON Schema estricto (QVAC, Qwen3-4B)
   → Follow-ups por dato faltante + confirmación
   → Duplicate detection + estados Confirmed/Reported/Estimated/Unknown
   → Store SQLite
   → Customer 360 / Dashboard / Analytics NL
```

## Estructura

```
src/
  agent/agent.ts        # Lógica conversacional: follow-ups, duplicados, guardado
  extract/extractor.ts  # Extracción NL→JSON con QVAC (responseFormat json_schema)
  store/db.ts           # SQLite: customers, observations, equipment
  store/seed.ts         # Carga del dataset dummy (JSON, sin dependencia xlsx)
  insights/insights.ts  # Customer 360, global stats, NL analytics
  voice/transcribe.ts   # STT on-device (Whisper vía QVAC)
  evidence/logger.ts    # Log auditable (JSONL + CSV) de cargas e inferencias
  cli.ts                # Interfaz conversacional por terminal
  server.ts             # Dashboard web (Customer 360 + refresh opportunities)
```

## Requisitos

- Node.js ≥ 22.17, npm ≥ 10.9
- GPU con Vulkan ≥ 1.4 (GPU remota / PC objetivo). CPU funciona, pero más lento.
- Espacio en disco ≥ 5 GB (modelos).

## Quickstart

```bash
npm install

# 1) Cargar dataset dummy (20 observaciones de Philips)
npm run seed

# 2) Asistente conversacional (descarga Qwen3-4B en el primer uso)
npm run cli
#    "I'm at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT."
#    Comandos: /help /dashboard /customers /query <nl> /evidence /exit

# 3) Dashboard web
npm run server   # → http://localhost:4173

# Tests y seguridad
npm test
npm run typecheck
```

### Captura por voz

```bash
# Graba un WAV (16 kHz mono) y transcríbelo on-device:
node scripts/voice-capture.mjs nota.wav   # genera nota.txt con Whisper local
# luego pega el texto en el CLI, o usa /voice si lo implementas
```

## Modelos (registry QVAC)

| Uso | Modelo | Tamaño |
|-----|--------|--------|
| Extracción LLM | `QWEN3_4B_INST_Q4_K_M` | ~2.5 GB |
| Voz (STT) | `WHISPER_TINY` | ~75 MB |

Todos se descargan del registro distribuido QVAC al primer uso (`modelRegistry*`). También puedes apuntar `modelSrc` a cualquier `.gguf` local o URL de HuggingFace.

## Requisito técnico obligatorio

La inferencia corre **en el dispositivo** (Vulkan) vía `@qvac/sdk`. No se envía ningún prompt ni dato a una API de nube. ISD verifica este punto antes de pasar entregas a Philips; el log auditable en `evidence/evidence.csv` documenta cada carga de modelo e inferencia (TTFT, tokens/s, backend).

## Evidencia para evaluación

`npm run cli` genera en `evidence/`:
- `evidence.jsonl` — eventos estructurados (model_load, inference, model_unload).
- `evidence.csv` — exportación legible con métricas de rendimiento.

Exporta en cualquier momento con `/evidence` dentro del CLI.

## Seguridad

- CI gates (`.github/workflows/security-gates.yml`): secret scan (TruffleHog), SAST (Semgrep), SCA (`npm audit`), typecheck y tests.
- El dataset dummy se convierte a JSON en build-time (`scripts/convert-xlsx.mjs`) para **no** arrastrar la dependencia `xlsx` (vuln high sin fix, GHSA-4r6h-8v6p-xvw6) a producción. `npm audit` → **0 vulnerabilities**.
- No hay secretos en el repo; variables de entorno en `.env` (ver `.env.example`).

## Decisiones de diseño (alineadas con el brief de Philips)

- **Datos incompletos son valiosos**: brand/modelo/edad opcionales en el schema; lo desconocido queda `Unknown`, nunca inventado.
- **Estados de confianza**: `Confirmed`/`Reported`/`Estimated`/`Unknown` por observación, derivados de edad estimada y certeza declarada.
- **Detección de duplicados** por cliente + modalidad + marca + rango de fechas; extensible a verificación semántica con embeddings (stretch goal).
- **NL analytics** determinista y offline (`/query customers in Brazil with MR older than 7 years`), con cálculo por filas individuales (no promedios) para no perder equipos viejos mezclados con nuevos.

## Roadmap / stretch goals

### Conversación y revisión

La terminal y el chat web comparten el mismo borrador. Describe los equipos y responde
con los detalles adicionales; cada respuesta se incorpora al contexto de la observación.
Escribe `confirm` (o `confirmar`) para guardar lo revisado, `skip` para descartarlo o
`/new` para empezar otra observación. Si se detecta un duplicado, revisa la advertencia
y usa `save anyway` para guardarlo como una observación nueva.

La confirmación no vuelve a ejecutar la IA. `reviewConfirmed` indica que el usuario
revisó el registro; los equipos con edades estimadas conservan el estado `Estimated`.
`FIELDSIGHT_AUTOSAVE=1` permite guardar sin revisión, pero no evita la advertencia de duplicados.

`npm run web` sirve el chat en `http://localhost:4174` y el panel en
`http://localhost:4174/dashboard`. Los servidores escuchan solo en la máquina local.
Los borradores web caducan después de una hora de inactividad y no sobreviven a un
reinicio del servidor ni a la recarga de la página. Las observaciones guardadas sí permanecen en SQLite.

### Windows (PowerShell)

Si `npm ci` intenta compilar `better-sqlite3` con node-gyp, la versión fijada incluye
binarios precompilados. Para instalar y comprobar la lógica sin ejecutar scripts de instalación:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run seed
$env:FIELDSIGHT_EXTRACT_MODEL = "small"
npm run web
```

Las pruebas usan SQLite real y un extractor simulado: no descargan modelos ni prueban
la inferencia QVAC. El primer arranque con IA puede descargar el modelo seleccionado.

## Pendientes

- [x] Captura por texto conversacional
- [x] Extracción estructurada (JSON Schema)
- [x] Follow-ups automáticos + confirmación
- [x] Duplicate detection (reglas basadas en marca/modelo/edad/ventana de tiempo)
- [x] Estados y confianza por observación
- [x] Customer 360 + dashboard + NL analytics
- [ ] Captura por foto de placa (multimodal Qwen3-VL/OCR)
- [ ] Frescura de datos con alertas
- [ ] Oportunidades de renovación priorizadas por score
- [ ] Duplicate detection semántica con embeddings (`EMBEDDINGGEMMA_300M_Q4_0`)
