# Mosaic
**Una visión completa, pieza por pieza.**

### ¿Qué es?
**Mosaic** es una **web app de inteligencia de base instalada** que transforma las observaciones realizadas durante visitas a hospitales en información estructurada, confiable y accionable. Su concepto parte de una idea simple: **cada observación es una pieza y, al conectar esas piezas, se construye una visión completa de cada cliente.**

### Problemática
Ingenieros de servicio, vendedores y especialistas visitan hospitales y clínicas y recopilan información sobre los equipos que encuentran. Sin embargo, gran parte de este conocimiento queda disperso en notas personales, conversaciones o memoria, además de ser parcial e inconsistente. Esto dificulta que las organizaciones conozcan con claridad **qué equipos están instalados, dónde se encuentran y qué tan actualizada y confiable es la información disponible.**

### ¿Qué resuelve?
Mosaic permite registrar una observación mediante **texto o voz**, utilizando lenguaje natural en lugar de formularios complejos. La IA interpreta la información, identifica los datos relevantes del equipo, solicita información faltante, detecta posibles duplicados y asigna un nivel de confianza a cada observación. Así, las observaciones realizadas por diferentes colaboradores se conectan para construir una **visión consolidada de la base instalada por cliente y geografía.**

### ¿A quién ayuda?
Mosaic facilita el trabajo de los **colaboradores de campo, equipos de servicio y ventas** al simplificar la captura y consulta de información. Al mismo tiempo, proporciona a gerentes y organizaciones una visión más clara de su base instalada para identificar equipos antiguos, información que requiere verificación y posibles oportunidades de renovación.

### ¿Qué identifica?
Mosaic puede extraer información como **cliente, ciudad, país, modalidad, cantidad, marca, modelo y antigüedad**, cuando estos datos están disponibles. También identifica datos faltantes, posibles duplicados y estados de confianza como **Confirmed, Reported, Estimated o Unknown**, evitando asumir o inventar información que no haya sido proporcionada.


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

### Inferencia (100% local)

**Decisión del equipo: full local.** Cada máquina corre el modelo con su propio
hardware — GPU vía Vulkan si la hay, o CPU como fallback automático. No se
necesita configuración extra ni un servidor remoto: `npm run cli` y `npm run web`
funcionan tal cual en cualquier equipo. En máquinas modestas, el modelo chico
reduce la carga:

```bash
MOSAIC_EXTRACT_MODEL=small npm run cli   # Qwen3-0.6B (~382MB) en vez del 4B
```

El modelo 4B (~2.5GB) se descarga del registry QVAC al primer uso y se cachea en
`~/.qvac/models/`. La inferencia sobre los datos del cliente nunca sale de la
máquina.

> La delegación P2P a un server remoto (MOSAIC_LLM_URL y
> `docs/GUIDE_GPU_SERVER.md`) quedó implementada y verificada en
> `src/extract/remote.ts` como referencia/opción futura, pero **no** es el camino
> de la demo actual.

## App de escritorio (.exe para Windows)

La demo también se distribuye como app nativa (Electron + instalador NSIS).
Cualquier máquina Windows la instala sin Node, sin Visual Studio y sin configuración:

```bash
npm run desktop                # app en dev (ventana nativa + chat)
npm run desktop:pack           # app empaquetada sin instalador → release/win-unpacked/
npm run model:fetch            # descarga el modelo para empaquetarlo (offline)
npm run desktop:dist           # instalador → release/Mosaic-Setup.exe
npm run desktop:dist:offline   # igual, garantizando el modelo bundleado
```

- **Un solo .exe, todo incluido**: el instalador offline (**~1.2 GB**) lleva Electron,
  Node, el runtime de IA (QVAC + bare + addons nativos) y el modelo **Qwen3-1.7B Q4_0**
  (~1 GB). La app funciona sin internet desde el primer segundo.
- Si `assets/models/` está vacío, `desktop:dist` produce el instalador liviano (~254 MB)
  que descarga el modelo al primer uso.
- NSIS tiene un tope de ~2 GB por instalador: por eso se bundlea el 1.7B (el 4B de
  ~2.5 GB requiere un compilador NSIS especial; ver `scripts/fetch-model.mjs`).
- Instalación por usuario (sin admin), accesos directos y desinstalador.
- **Primera ejecución (onboarding)**: la app pregunta idioma (**solo English/Español**),
  tu nombre y tu ubicación actual (GPS con opción manual). Se guarda en
  `%APPDATA%\Mosaic\data\settings.json`: el idioma queda fijado para siempre en todas
  las conversaciones con la IA y el nombre firma tus observaciones.
- Tras el onboarding, lo primero que ves es el **chat saludándote por nombre** en tu idioma,
  con el modelo cargando en segundo plano (barra de progreso en el splash/onboarding).
- El modelo corre en **GPU (Vulkan) cuando está disponible** y cae a CPU automáticamente.
- Los datos viven en `%APPDATA%\Mosaic` (DB, evidencia, logs); la DB arranca vacía (sin seed
  automático) y el chat tiene botones **Demo** (carga el dataset dummy de 13 clientes para
  la presentación) y **Clear DB** (borra todo). `npm run seed` también carga el dataset en CLI/web.
- **Captura por voz**: mantén el 🎤 en el chat; Whisper large-v3-turbo transcribe on-device
  y **se descarga (~1.6 GB) solo la primera vez que usás voz**.
- La app es 100% local: la ventana carga el chat desde un servidor efímero en
  `127.0.0.1` embebido en el proceso.
- **Seguridad**: sandbox + context isolation en el renderer, CSP inyectada por sesión,
  navegación externa bloqueada (solo http/https al navegador) y permisos denegados.
  DevTools solo en desarrollo.
- **Auto-update**: soporte con `electron-updater` contra GitHub Releases. El chequeo es
  **manual** (menú Help → Check for updates) para mantener la app offline por defecto;
  `MOSAIC_AUTO_UPDATE=1` lo activa al arrancar. Requiere un release **publicado** (no draft);
  en repo privado el updater necesita visibilidad/token.
- **Logs y crashes**: `%APPDATA%\Mosaic\logs\main.log` (menú File/Help abre la carpeta);
  los crashes del renderer muestran diálogo y quedan registrados.
- **Tests E2E**: `npm run test:e2e` lanza la app real con un stub OpenAI-compatible
  (no descarga modelo) y valida arranque, seed y conversación.
- **Firma de código**: lista para CI. Al configurar los secrets `WIN_CSC_LINK` /
  `WIN_CSC_KEY_PASSWORD`, electron-builder firma el instalador automáticamente.
  Sin certificado, SmartScreen puede pedir confirmación la primera vez.
- **Release**: `.github/workflows/release-desktop.yml` compila y publica un draft en
  GitHub Releases al pushear un tag `v*`; `desktop-e2e.yml` corre los E2E en PRs.

## Modelos (registry QVAC)

| Uso | Modelo | Tamaño |
|-----|--------|--------|
| Extracción (bundleado en el .exe) | `QWEN3_1_7B_INST_Q4` (`Qwen3-1.7B-Q4_0.gguf`) | ~1.0 GB |
| Extracción (CLI/web, descarga) | `QWEN3_4B_INST_Q4_K_M` | ~2.5 GB |
| Extracción liviana | `QWEN3_600M_INST_Q4` | ~0.4 GB |
| Voz (STT) | `WHISPER_LARGE_V3_TURBO` | ~1.6 GB (lazy, primera voz) |

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
`MOSAIC_AUTOSAVE=1` permite guardar sin revisión, pero no evita la advertencia de duplicados.

`npm run web` sirve el chat en `http://localhost:4174` y el panel en
`http://localhost:4174/dashboard`. Los servidores escuchan solo en la máquina local.
Los borradores web caducan después de una hora de inactividad y no sobreviven a un
reinicio del servidor ni a la recarga de la página. Las observaciones guardadas sí permanecen en SQLite.

### Windows (PowerShell)

Si `npm ci` intenta compilar `better-sqlite3` con node-gyp (v13 publica prebuilds
N-API, pero npm igual dispara el rebuild), instala **Visual Studio Build Tools 2022**
con la carga "Desktop development with C++" y Python. Para instalar y comprobar la
lógica sin ejecutar scripts de instalación:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run seed
$env:MOSAIC_EXTRACT_MODEL = "small"
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


### Chat restringido al dataset de Excel

El chat usa exclusivamente el catálogo de `data/Dummy_Installed_Base_Hackathon.xlsx`,
a través de su exportación verificada `data/dummy_installed_base.json` (20 filas).
Las observaciones guardadas en SQLite no amplían ese catálogo.

- Hospital y ubicación deben coincidir con el Excel. La ubicación ausente se toma del hospital seleccionado.
- Modalidad, marca, modelo, cantidad y antigüedad deben pertenecer a la misma fila del hospital.
- Cada dato faltante o incompatible produce opciones válidas; las respuestas a esas preguntas no usan el LLM.
- Se aceptan variantes de mayúsculas/acentos. Los errores tipográficos requieren elegir una sugerencia.
- No se guarda hasta completar la validación, incluso con autosave o `save anyway`.
- `no sé` no omite campos obligatorios. Usa `/new` o `skip` para descartar y comenzar otra observación.
- Voz transcrita y texto pasan por la misma validación. Notas generadas no se incorporan como hechos del catálogo.

Ejemplo: escribe `Estoy en Hospital DemoCare Pacific en Panama City, Panama. Tienen dos MR.`
Completa con **NovaMed → NM-MR 700 → 7** y revisa antes de confirmar. Si escribes **Philips**
o una edad de **25**, se pedirán los valores del Excel y el registro no se guardará.

Para probar esta copia local (elige otro puerto si 4174 ya está ocupado):

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
$env:PORT = "4195"
$env:MOSAIC_EXTRACT_MODEL = "small"
npm run web
```

Abre `http://localhost:4195`. La primera descripción usa QVAC local; las preguntas posteriores
se resuelven contra el catálogo. No es necesario sembrar SQLite para disponer de sugerencias.
Las pruebas automatizadas usan un extractor simulado y cubren rechazo, recuperación y guardado.
