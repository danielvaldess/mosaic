# Guide: Run the GPU Inference Server (Liz & Miranda)

> Esta guía es para los colaboradores con la **RTX 3050**. Al ejecutarla, tu
> máquina expone el modelo Qwen3-4B como un servidor local (OpenAI-compatible).
> Daniel (sin GPU) se conectará a este servidor desde su máquina para delegar
> la inferencia — los datos viajan solo entre sus equipos, sin nube. Esto es
> "inferencia delegada peer-to-peer", permitida por el reto.

## Requisitos

- Windows 10/11 con la **RTX 3050** y drivers NVIDIA actualizados (Vulkan ≥ 1.4).
- Node.js ≥ 22.17 y npm ≥ 10.9.
- **5 GB de espacio libre** en disco (el modelo Qwen3-4B pesa ~2.5 GB).

## Paso 1 — Clonar el repo y entrar a la rama

```powershell
git clone https://github.com/danielvaldess/mosaic.git
cd mosaic
git checkout feat/conversational-p2p
```

(Espera a que Daniel te avise antes de continuar — él debe terminar primero
su parte del lado cliente.)

## Paso 2 — Instalar dependencias

```powershell
npm install
```

## Paso 3 — Instalar el CLI de QVAC (una vez)

```powershell
npm install -g @qvac/cli
```

## Paso 4 — Arrancar el servidor de inferencia

El repo incluye la config lista en `config/qvac.serve.json`. Para que otros
equipos de la LAN puedan conectarse, QVAC **exige una clave de acceso**
(`--api-key`). Genera una clave (cualquier texto largo) y guarda tu IP local:

```powershell
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
$key = "TU_CLAVE_SECRETA_LARGA"
Write-Host "IP: $ip  Clave: $key"
```

Luego arranca el server apuntando a la config del repo:

```powershell
qvac serve --openai --no-default -c config/qvac.serve.json -H $ip -p 11437 --api-key $key
```

> **Importante**: usa `-c config/qvac.serve.json` (la variable `QVAC_CONFIG_PATH`
> no la lee este CLI). Y usa `-H <tu-IP-local>`, no `0.0.0.0`.

**Primera vez**: descargará el modelo Qwen3-4B (~2.5 GB) y lo precargará en la
GPU. Tardará unos minutos. Verás algo como `Preloading 1 model(s): mosaic-llm`.

**Verificar que funciona** (en otra terminal):

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $key" } http://localhost:11437/v1/models
```

Debe responder con una lista que incluye `mosaic-llm` (state `ready`).

## Paso 5 — Compartir la dirección a Daniel

Dile a Daniel la **IP local** y la **clave**:

> La URL es `http://<IP>:11437/v1`, el modelo es `mosaic-llm` y la clave es `<key>`.

Daniel pondrá esto en su máquina:

```powershell
$env:MOSAIC_LLM_URL = "http://<IP>:11437/v1"
$env:MOSAIC_LLM_MODEL = "mosaic-llm"
$env:MOSAIC_LLM_API_KEY = "<key>"
npm run cli
```

## Notas importantes

- **Misma red**: si están en el mismo Wi-Fi/LAN, funciona directo. Si están en
  redes distintas (casa/universidad), ambos instalan **Tailscale** (gratis,
  hasta 3 dispositivos), se agregan a la misma red, y en vez de la IP local se
  usa la IP de Tailscale (`100.x.y.z`).
- **No apagues la PC** mientras Daniel esté probando.
- **Firewall de Windows**: si Daniel no puede conectarse, abre el puerto
  `11437` en el firewall de Windows para tu red local.
- **Seguridad**: la clave protege el server. No compartas la clave fuera del
  equipo, y no expongas el puerto a internet.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `vulkan` no encontrado / error de GPU | Actualiza drivers NVIDIA desde GeForce Experience |
| El modelo no carga | Verifica 5 GB libres; borra caché `~\.qvac\models` y reintenta |
| Daniel no conecta | Verifica IP, firewall, que uses `-c config/qvac.serve.json` y que ambos estén en la misma red/Tailscale |
| Error de autenticación (401) | Confirma que Daniel usa la misma clave en `MOSAIC_LLM_API_KEY` |
| El comando de verificación no responde | Asegúrate de que la variable `$key` siga definida en esa terminal; si el server aún carga el modelo, espera y reintenta |