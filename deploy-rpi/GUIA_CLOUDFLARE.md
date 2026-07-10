# Guía completa — Raspberry Pi (Raspberry Pi OS) + Cloudflare Tunnel

## Tus datos de conexión

```
Usuario:  bot
Host:     100.82.71.27   (IP de Tailscale — 100.64.0.0/10)
```

> **Nota sobre la IP:** `100.82.71.27` está en el rango que usa Tailscale. Si tu PC
> Windows también tiene Tailscale instalado y conectado a la misma red (`tailscale status`
> debe mostrar el Pi), el SCP de abajo funciona directo, sin abrir puertos ni configurar
> nada extra — Tailscale ya cifra y enruta el tráfico entre tus dispositivos.
> Si `ssh bot@100.82.71.27` falla, verifica primero que Tailscale esté activo en ambos
> lados (`tailscale up` / ícono de Tailscale en la bandeja de Windows).

## Resumen del setup

```
Tu PC (Windows)
    │  SCP / rsync sobre Tailscale
    ▼
Raspberry Pi (Raspberry Pi OS)  ──── Next.js :3000
    │
    │  cloudflared tunnel (saliente, sin abrir puertos del router)
    ▼
Cloudflare Edge  ────  https://tudominio.com
    ▼
Usuarios de internet (acceso público, no solo tu red Tailscale)
```

La app corre en el Pi y es visible **solo dentro de tu Tailnet** hasta que montamos el
Cloudflare Tunnel — ese es el paso que la hace accesible a cualquier persona en internet,
no solo a los dispositivos con Tailscale.

---

## PARTE 1 — Verificar acceso SSH

```powershell
# Windows PowerShell o Git Bash
ssh bot@100.82.71.27
```

Si pide contraseña y no la tienes, pídesela a quien configuró el Pi, o si tienes acceso
físico/otro método, resetéala con `passwd` una vez dentro.

Verifica versión del sistema y arquitectura (útil para saber qué build de cloudflared bajar,
aunque el script ya lo detecta solo):

```bash
# Dentro del Pi
cat /etc/os-release | grep PRETTY_NAME
uname -m          # aarch64 = 64-bit, armv7l = 32-bit
free -h           # RAM disponible
```

Sal de vuelta a tu PC con `exit` antes del siguiente paso.

---

## PARTE 2 — Enviar el código al Pi

### Desde Windows — PowerShell

```powershell
# 1. Copiar la carpeta deploy-rpi al Pi
scp -r C:\Users\lecor\Documents\utec\crypto\proyecto11\deploy-rpi bot@100.82.71.27:~/peruvianmarket

# 2. Copiar el código de la app SIN node_modules (son ~300MB innecesarios de transferir)
robocopy "C:\Users\lecor\Documents\utec\crypto\proyecto11\web" "C:\Temp\app-deploy" /E /XD node_modules .next .git /XF "*.log"
scp -r C:\Temp\app-deploy\* bot@100.82.71.27:~/peruvianmarket/app/

# 3. Copiar el .env.local (va aparte porque robocopy no lo excluye por nombre arriba, pero
#    conviene copiarlo explícito para no olvidarlo)
scp C:\Users\lecor\Documents\utec\crypto\proyecto11\web\.env.local bot@100.82.71.27:~/peruvianmarket/app/.env.local
```

### Desde Git Bash / WSL (alternativa con rsync — más rápido en actualizaciones futuras)

```bash
scp -r /c/Users/lecor/Documents/utec/crypto/proyecto11/deploy-rpi bot@100.82.71.27:~/peruvianmarket

rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  /c/Users/lecor/Documents/utec/crypto/proyecto11/web/ \
  bot@100.82.71.27:~/peruvianmarket/app/
```

### Verificar que llegó todo

```bash
ssh bot@100.82.71.27
ls ~/peruvianmarket/            # setup.sh, deploy.sh, update.sh, ecosystem.config.js...
ls ~/peruvianmarket/app/        # package.json, src/, .env.local...
cat ~/peruvianmarket/app/.env.local | head -3   # confirma que no está vacío
```

---

## PARTE 3 — Setup en el Pi

```bash
# Ya conectado por SSH (bot@100.82.71.27)
cd ~/peruvianmarket
chmod +x setup.sh deploy.sh update.sh

# Ejecutar setup (solo una vez — instala Node, PM2, cloudflared; ~5 min)
./setup.sh

# Ejecutar deploy (compila Next.js — en un Pi 4 tarda 5-10 min, en un Pi 3/Zero más)
./deploy.sh
```

Cuando termine, verifica:
```bash
pm2 list                     # peruvianmarket → online
curl http://localhost:3000   # debe devolver HTML
```

Si `curl` no devuelve nada, revisa logs con `pm2 logs peruvianmarket --lines 50` antes de
seguir — no tiene sentido montar el tunnel si la app no levanta local.

---

## PARTE 4 — Cloudflare Tunnel (acceso público mundial)

### 4.1 Crear cuenta Cloudflare
https://cloudflare.com → Sign Up (gratis)

### 4.2 Prueba rápida (URL temporal, sin dominio)

Para confirmar que el tunnel funciona antes de comprometerte con un dominio:

```bash
cloudflared tunnel --url http://localhost:3000
```

Te dará una URL tipo:
```
https://algo-aleatorio.trycloudflare.com
```

Ábrela desde tu celular con datos móviles (no WiFi de casa) para confirmar que es
**realmente pública** y no solo accesible dentro de tu red/Tailnet. `Ctrl+C` para cortar
cuando confirmes.

### 4.3 Dominio (necesario para algo permanente)

- **Opción barata:** https://porkbun.com (`.xyz` desde ~$1/año) o https://namecheap.com
- Si ya tienes uno de cualquier registrar, sirve igual.

Agrégalo a Cloudflare:
1. Dashboard → "Add a site" → ingresa el dominio → plan **Free**
2. Cloudflare te da 2 nameservers (ej. `ada.ns.cloudflare.com`)
3. En tu registrar (donde compraste el dominio) → cambia los nameservers a esos
4. Espera 5-30 min a que propague (Cloudflare te avisa por email cuando está activo)

### 4.4 Crear el tunnel permanente (en el Pi)

```bash
# Abre una URL — cópiala y ábrela en tu navegador para autorizar
cloudflared tunnel login

# Crear el tunnel
cloudflared tunnel create peruvianmarket
# Anota el ID que imprime: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

cloudflared tunnel list   # confirma que aparece
```

### 4.5 Archivo de configuración

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Pega (reemplaza `TU_TUNNEL_ID` y `tudominio.com` — y nota que el usuario es `bot`, no `root`):

```yaml
tunnel: TU_TUNNEL_ID
credentials-file: /home/bot/.cloudflared/TU_TUNNEL_ID.json

ingress:
  - hostname: tudominio.com
    service: http://localhost:3000
  - hostname: www.tudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

Guarda: `Ctrl+O` → Enter → `Ctrl+X`

### 4.6 Crear registros DNS

```bash
cloudflared tunnel route dns peruvianmarket tudominio.com
cloudflared tunnel route dns peruvianmarket www.tudominio.com
```

### 4.7 Probar antes de instalarlo como servicio

```bash
cloudflared tunnel run peruvianmarket
```

Abre `https://tudominio.com` desde un dispositivo fuera de tu red (datos móviles). Si
carga, `Ctrl+C`.

### 4.8 Instalar como servicio del sistema (arranca solo al prender el Pi)

```bash
sudo cloudflared --config /home/bot/.cloudflared/config.yml service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## PARTE 5 — Verificación final

```bash
pm2 list                                  # app online
sudo systemctl status cloudflared         # tunnel activo
curl -s http://localhost:3000 | head -5   # responde local
pm2 logs peruvianmarket                   # logs de la app
sudo journalctl -u cloudflared -f         # logs del tunnel
```

Desde tu celular con datos móviles: abre `https://tudominio.com` — si carga ahí, es
accesible para cualquiera en internet, no solo para ti.

---

## Actualizaciones futuras

```bash
# 1. Desde Windows — enviar cambios
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.git' \
  /c/Users/lecor/Documents/utec/crypto/proyecto11/web/ \
  bot@100.82.71.27:~/peruvianmarket/app/

# 2. En el Pi
cd ~/peruvianmarket
./update.sh
```

---

## Comandos de mantenimiento

```bash
pm2 restart peruvianmarket          # reiniciar app
pm2 logs peruvianmarket --lines 50  # ver logs
pm2 monit                           # CPU/RAM en vivo
sudo systemctl restart cloudflared  # reiniciar tunnel
ss -tn state established | grep :3000 | wc -l   # conexiones activas ahora mismo
htop                                 # uso general del Pi
```

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `ssh bot@100.82.71.27` no conecta | Tailscale desconectado en tu PC o el Pi | `tailscale status` en ambos lados; reconecta con `tailscale up` |
| Build falla con "heap out of memory" | Poca RAM (Pi 3 / Zero) | `deploy.sh` ya ajusta el heap según RAM detectada; si sigue fallando, cierra otros procesos o agrega swap |
| `pm2 list` muestra `errored` | Error en runtime | `pm2 logs peruvianmarket` para ver el stack trace |
| Cloudflare da "502 Bad Gateway" | App caída localmente | `pm2 restart peruvianmarket` |
| URL de Cloudflare no carga desde afuera pero sí desde el Pi | Tunnel no está corriendo o DNS no propagó | `sudo systemctl status cloudflared`; espera propagación DNS |
| SCP muy lento | Se coló `node_modules` | Revisa que el `robocopy`/`rsync` haya excluido `node_modules` y `.next` |
| `sudo` pide contraseña en cada paso | Normal para usuario no-root | Ingrésala cuando la pida; no es necesario cambiar nada |
