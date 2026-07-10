# Despliegue 100% gratuito — Tailscale Funnel

## Por qué esta opción y no Cloudflare Tunnel

Ya tienes Tailscale instalado y conectado en el Pi (por eso `100.82.71.27`). Tailscale
incluye una función llamada **Funnel** que expone un servicio local a internet con una
URL HTTPS pública y estable — **sin comprar dominio, sin abrir puertos del router, sin
pagar nada**. Funciona incluso si tu ISP te da una IP compartida (CGNAT), porque el
tráfico pasa por los servidores de relay de Tailscale.

```
Internet (cualquier persona)
        │
        ▼
https://bot.tu-tailnet.ts.net   ← URL pública, gratis, la da Tailscale
        │
        ▼  (Tailscale Funnel — TLS automático)
Raspberry Pi ── Next.js :3000 (PM2)
```

La alternativa de Cloudflare Tunnel que armamos antes (`GUIA_CLOUDFLARE.md`) sigue
siendo válida si más adelante quieres un dominio bonito tipo `tudominio.com`
(cuesta ~$1-2/año), pero para "gratis ya" esto es más directo.

---

## Paso 0 — Confirmar que Tailscale está activo

```bash
tailscale status
```

Debe mostrarte tu Pi con estado `online`. Si no, actívalo:

```bash
sudo tailscale up
```

## Paso 1 — Habilitar HTTPS en tu tailnet

Entra a **https://login.tailscale.com/admin/dns** (con la cuenta que usaste para
conectar el Pi) y activa el toggle **"HTTPS Certificates"** si no está ya activado.
Esto permite que Tailscale emita certificados TLS automáticos para tus dispositivos.

## Paso 2 — Activar Funnel para este dispositivo

En el Pi, ejecuta:

```bash
sudo tailscale funnel 3000
```

La primera vez, te va a imprimir una URL de autorización tipo:

```
To start funneling, please visit the admin panel:
https://login.tailscale.com/f/funnel?node=...
```

Ábrela en tu navegador (en tu PC, no en el Pi) y aprueba **"Enable Funnel"** para ese
dispositivo. Vuelve a correr el mismo comando después de aprobar:

```bash
sudo tailscale funnel 3000
```

## Paso 3 — Verificar

```bash
tailscale funnel status
```

Te dará algo como:

```
https://bot.tail-scale-name.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:3000
```

Esa URL (`https://bot.xxxx.ts.net`) ya es pública. Ábrela desde tu celular **con datos
móviles (no WiFi de casa)** para confirmar que cualquiera en internet puede entrar, no
solo dispositivos en tu Tailnet.

## Paso 4 — Dejarlo corriendo permanentemente

Tailscale Funnel se guarda en el estado de `tailscaled`, que ya corre como servicio del
sistema (systemd) instalado junto con Tailscale — **no necesitas nada extra para que
sobreviva a un reinicio del Pi**. Verifica que el servicio esté habilitado:

```bash
sudo systemctl is-enabled tailscaled   # debe decir "enabled"
sudo systemctl status tailscaled       # debe decir "active (running)"
```

Si por algún motivo lo desactivaste, vuelve a activarlo:

```bash
sudo systemctl enable --now tailscaled
```

---

## Diferencia clave con la URL de prueba de Cloudflare

A diferencia de `cloudflared tunnel --url` (que genera una URL nueva cada vez que
reinicias el proceso), la URL de Funnel es **estable**: siempre será
`https://<nombre-del-dispositivo>.<tu-tailnet>.ts.net` mientras no cambies el nombre
del dispositivo en Tailscale. Puedes compartir ese link con confianza de que no cambia.

Para renombrar el dispositivo (y por tanto la URL) si quieres algo más corto:

```bash
sudo tailscale set --hostname=peruvianmarket
```

Luego la URL pasa a ser `https://peruvianmarket.<tu-tailnet>.ts.net`.

---

## Verificación final

```bash
# En el Pi
pm2 list                          # app online
tailscale funnel status           # funnel activo, apuntando a :3000
curl -s http://localhost:3000 | head -5   # responde local
```

Desde tu celular con datos móviles: abre la URL `https://....ts.net` — si carga, ya es
pública para todo el mundo.

---

## Comandos de mantenimiento

```bash
tailscale funnel status              # ver estado y URL actual
sudo tailscale funnel off             # apagar el funnel (deja de ser público)
sudo tailscale funnel 3000            # volver a prenderlo
pm2 restart peruvianmarket            # reiniciar la app si hace falta
sudo systemctl restart tailscaled     # reiniciar tailscale si se cuelga
```

---

## Límites a tener en cuenta (plan gratis de Tailscale)

| Límite | Detalle |
|---|---|
| Dispositivos en tailnet | 100 en plan Personal gratis — de sobra para esto |
| Ancho de banda | Sin límite duro documentado para tráfico normal de Funnel, pero es un relay compartido — para tráfico muy alto sostenido, Cloudflare (que es CDN real) escala mejor |
| Dominio | `*.ts.net` fijo — no puedes usar tu propio dominio con Funnel (para eso sí necesitas Cloudflare Tunnel + dominio propio) |
| Puertos | Funnel soporta 443, 8443, 10000 como puertos públicos de entrada (se mapean internamente al puerto que definas, en tu caso 3000) |

Si en el futuro el proyecto crece y quieres tu propio dominio (`tudominio.com`) en vez
de `algo.ts.net`, ahí retomas `GUIA_CLOUDFLARE.md` — ambos pueden convivir, incluso, ya
que usan mecanismos distintos.
