# Mosaic
**Una visión completa, pieza por pieza.**

Mosaic es la solución al reto de **inteligencia de base instalada**: convierte las
observaciones de campo en información estructurada, confiable y accionable, con
**IA 100% local**.

---

## ¿Qué es?

**Mosaic** es una solución de inteligencia de base instalada que transforma las observaciones realizadas durante visitas a hospitales en información estructurada, confiable y accionable. Su concepto parte de una idea simple: **cada observación es una pieza y, al conectar esas piezas, se construye una visión completa de cada cliente.**

### Problemática

Ingenieros de servicio, vendedores y especialistas visitan hospitales y clínicas y recopilan información sobre los equipos que encuentran. Sin embargo, gran parte de este conocimiento queda disperso en notas personales, conversaciones o memoria, además de ser parcial e inconsistente. Esto dificulta que las organizaciones conozcan con claridad **qué equipos están instalados, dónde se encuentran y qué tan actualizada y confiable es la información disponible.**

### ¿Qué resuelve?

Mosaic permite registrar una observación mediante **texto o voz**, utilizando lenguaje natural en lugar de formularios complejos. La IA interpreta la información, identifica los datos relevantes del equipo, solicita información faltante, detecta posibles duplicados y asigna un nivel de confianza a cada observación. Así, las observaciones realizadas por diferentes colaboradores se conectan para construir una **visión consolidada de la base instalada por cliente y geografía.**

### ¿A quién ayuda?

Mosaic facilita el trabajo de los **colaboradores de campo, equipos de servicio y ventas** al simplificar la captura y consulta de información. Al mismo tiempo, proporciona a gerentes y organizaciones una visión más clara de su base instalada para identificar equipos antiguos, información que requiere verificación y posibles oportunidades de renovación.

### ¿Qué identifica?

Mosaic extrae información como **cliente, ciudad, país, modalidad, cantidad, marca, modelo y antigüedad**, cuando estos datos están disponibles. También identifica datos faltantes, posibles duplicados y estados de confianza como **Confirmed, Reported, Estimated o Unknown**, evitando asumir o inventar información que no haya sido proporcionada.

---

## Cómo sustentamos el reto

- **Atacamos la problemática de punta a punta**: la información que hoy se pierde en notas, conversaciones y memoria se captura en el momento, se estructura con IA local y se consolida en una vista por cliente y geografía.
- **Cumplimos la restricción técnica del reto**: la inferencia corre **en el dispositivo** (nunca en la nube) vía QVAC. Cada carga de modelo e inferencia queda registrada en un **log auditable** (`evidence.jsonl` / `evidence.csv`) para la verificación de ISD.
- **Facilitamos la adopción**: una página web de presentación con **video de uso**, y una **app de escritorio** que se instala con un clic, sin Node ni configuración.

---

## Qué incluye el proyecto

| Componente | Descripción |
|---|---|
| **Página web** | Landing del proyecto en https://danielvaldess.github.io/mosaic/ con botón de descarga directa de la app para Windows y el **video de presentación** que guía el uso. |
| **App de escritorio (Windows)** | Instalador `.exe` offline (~1.2 GB) con todo incluido. Cada persona captura sus observaciones desde la app y todo queda **centralizado en una base local estructurada**, consultable por cliente y geografía. |
| **Chat conversacional** | Español/Inglés, con texto y voz on-device, seguimiento de datos faltantes y confirmación antes de guardar. |
| **Dashboard** | Customer 360, estadísticas globales, candidatos a refresco y analítica en lenguaje natural. |
| **CLI** | El mismo motor desde la terminal, para integraciones y pruebas. |

---

## Pipeline

```
Captura (texto/voz)
   → Extracción LLM local con JSON Schema estricto (QVAC, Qwen3)
   → Integración con el dataset (sugerencias y validación de respuestas)
   → Follow-ups por dato faltante + confirmación
   → Duplicate detection + estados Confirmed/Reported/Estimated/Unknown
   → Store SQLite
   → Customer 360 / Dashboard / Analytics NL
```

---

## La IA se alimenta del dataset

Para integrar las respuestas del usuario con precisión, la IA se alimenta de un
**dataset de base instalada** (hospitales, ciudades, países, modalidades, marcas,
modelos, cantidades y antigüedades reales):

- Cada respuesta se contrasta con ese vocabulario con tolerancia a **acentos, mayúsculas y errores tipográficos**; cuando el valor no coincide, Mosaic sugiere las opciones más cercanas en lugar de inventar.
- Los datos faltantes o incompatibles generan **preguntas especializadas con opciones** (estas preguntas se resuelven contra el dataset, sin gastar una inferencia).
- Nada se guarda hasta completar la validación, incluso con autosave. `no sé` no omite campos obligatorios; `/new` o `skip` descartan y permiten empezar de nuevo.
- Voz y texto pasan por la misma validación. Las notas generadas se conservan como evidencia, no como hechos del catálogo.

---

## Modelos e integración con QVAC

**QVAC es el pegamento que integra todos los servicios de IA en el dispositivo.**
La app se comunica con el SDK `@qvac/sdk`, que levanta un **runtime local dedicado
(`bare`)** conectado por un canal RPC propio; ese runtime carga los **addons nativos**
de inferencia (llamacpp-completion para texto y whispercpp-transcription para voz) y
ejecuta en **GPU (Vulkan)** cuando está disponible, con **fallback automático a CPU**.

| Uso | Modelo | Tamaño | Cuándo se obtiene |
|-----|--------|--------|-------------------|
| Extracción (bundleado en el .exe) | `Qwen3-1.7B-Q4_0` | ~1.0 GB | Viene en el instalador, 100% offline |
| Extracción (CLI/web) | `QWEN3_4B_INST_Q4_K_M` | ~2.5 GB | Descarga al primer uso |
| Extracción liviana (demos) | `QWEN3_600M_INST_Q4` | ~0.4 GB | `MOSAIC_EXTRACT_MODEL=small` |
| Voz (STT) | `WHISPER_LARGE_V3_TURBO` | ~1.6 GB | Se descarga solo la primera vez que se usa voz |

Los modelos se obtienen del **registro distribuido QVAC** con verificación de
integridad (SHA-256) y se cachean en `~/.qvac/models/`; la app de escritorio además
carga el `.gguf` que viene dentro del instalador, sin tocar la red. También puede
apuntarse `modelSrc` a cualquier `.gguf` local o URL de HuggingFace.

---

## App de escritorio (.exe para Windows)

La distribución principal es una app nativa (Electron + instalador NSIS) que
cualquier máquina Windows 10/11 (x64) instala **sin Node, sin Visual Studio y sin
configuración**:

- **Un solo .exe, todo incluido**: Electron, Node, el runtime de IA (QVAC + `bare` +
  addons nativos) y el modelo Qwen3-1.7B. Funciona sin internet desde el primer segundo.
- **Primera ejecución (onboarding)**: idioma (English/Español), nombre y ubicación
  (GPS con opción manual). El idioma queda fijado para las conversaciones y el nombre
  firma las observaciones; el chat te saluda por nombre y el modelo carga en segundo plano.
- **Captura por voz**: mantén el 🎤 en el chat; Whisper transcribe on-device y el texto
  pasa por la misma validación que el escrito.
- **Botón Demo** (carga el dataset de ejemplo) y **Clear DB** (reinicia la base).
- **Seguridad**: sandbox + context isolation, CSP por sesión, navegación externa bloqueada,
  permisos denegados (micrófono solo para el origen local), DevTools solo en desarrollo.
- **Auto-update** con GitHub Releases (chequeo manual desde el menú Help, offline por defecto).
- **Logs y crashes** en `%APPDATA%\Mosaic\logs\main.log` con diálogo ante fallos del renderer.
- **Firma de código** lista para CI (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`); sin
  certificado, SmartScreen puede pedir confirmación la primera vez.

Descarga directa: **https://github.com/danielvaldess/mosaic/releases/latest**

---

## Desarrollo

### Requisitos

- Node.js ≥ 22.17, npm ≥ 10.9
- GPU con Vulkan ≥ 1.4 opcional (CPU funciona, más lento)
- ~5 GB de disco para modelos

### Quickstart

```bash
npm install

# Chat conversacional (descarga el modelo al primer uso)
npm run cli

# Chat web → http://localhost:4174
npm run web

# Dashboard solo-lectura → http://localhost:4173
npm run server

# Dataset de ejemplo (20 observaciones)
npm run seed
```

### App de escritorio

```bash
npm run desktop                # app en dev (ventana nativa + chat)
npm run desktop:pack           # app empaquetada sin instalador → release/win-unpacked/
npm run model:fetch            # descarga el modelo para empaquetarlo (offline)
npm run desktop:dist           # instalador → release/Mosaic-Setup.exe
npm run desktop:dist:offline   # igual, garantizando el modelo bundleado
```

El instalador se publica automáticamente en GitHub Releases al pushear un tag `v*`
(`.github/workflows/release-desktop.yml`).

### Verificación

```bash
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm test            # 141 tests unitarios (vitest)
npm run test:e2e    # Playwright sobre la app Electron real (stub LLM, sin descargar modelos)
```

CI en cada PR: secret scan (TruffleHog), SAST (Semgrep), `npm audit`, typecheck,
tests y E2E de la app de escritorio. **0 vulnerabilidades.**

### Windows (PowerShell)

`better-sqlite3` v13 compila con node-gyp aunque traiga prebuilds N-API: instala
**Visual Studio Build Tools 2022** con la carga "Desktop development with C++" y Python.
Alternativa sin compilar:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
```

---

## Evidencia para evaluación

Cada carga de modelo e inferencia queda registrada:

- `evidence/evidence.jsonl` — eventos estructurados (`model_load`, `inference`, `model_unload`).
- `evidence/evidence.csv` — exportación legible con TTFT, tokens/s y backend.

Esto documenta que la IA corre **en el dispositivo** y respalda la verificación de ISD.

---

## Decisiones de diseño

- **Datos incompletos son valiosos**: lo desconocido queda `Unknown`, nunca inventado.
- **Estados de confianza**: `Confirmed`/`Reported`/`Estimated`/`Unknown` por observación.
- **Detección de duplicados** por cliente + modalidad + marca + rango de fechas.
- **NL analytics** determinista y offline, calculado por filas individuales para no
  perder equipos viejos mezclados con nuevos.
- **El catálogo es inmutable e independiente de SQLite**: borrar o añadir observaciones
  no cambia las opciones con las que se valida.

---

## Mejoras futuras

- Captura por **foto de placa** (multimodal Qwen3-VL / OCR) como fuente adicional de observaciones.
- **Duplicados semánticos** con embeddings (misma máquina escrita distinto).
- Alertas de **frescura de datos** y oportunidades de renovación priorizadas por score.
- **Firma de código** con certificado para eliminar la advertencia de SmartScreen.
- Auto-update automático al arrancar (hoy es manual para respetar la regla de red).
- Delegación **P2P opcional** a una GPU del equipo (implementada como referencia en
  `src/extract/remote.ts` y `docs/GUIDE_GPU_SERVER.md`).
