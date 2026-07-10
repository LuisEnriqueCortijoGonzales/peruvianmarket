#!/bin/bash
# =============================================================================
# setup.sh — Ejecutar UNA SOLA VEZ en la Raspberry Pi nueva
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${YELLOW}[$1/6] $2...${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║   Peruvian Market — Setup Raspberry Pi   ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Actualizar sistema ────────────────────────────────────────────────────
step 1 "Actualizando sistema"
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential unzip
ok "Sistema actualizado"

# ── 2. Node.js 20 LTS ────────────────────────────────────────────────────────
step 2 "Instalando Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
ok "Node.js $(node --version) — npm $(npm --version)"

# ── 3. PM2 ───────────────────────────────────────────────────────────────────
step 3 "Instalando PM2 (gestor de procesos)"
sudo npm install -g pm2
ok "PM2 $(pm2 --version)"

# Configurar PM2 para arrancar con el sistema
PM2_STARTUP=$(pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1)
if [[ "$PM2_STARTUP" == sudo* ]]; then
    eval "$PM2_STARTUP"
    ok "PM2 configurado para arranque automático"
fi

# ── 4. cloudflared ───────────────────────────────────────────────────────────
step 4 "Instalando cloudflared (Cloudflare Tunnel)"
ARCH=$(uname -m)
case "$ARCH" in
    aarch64) CF_ARCH="arm64"  ;;
    armv7l)  CF_ARCH="arm"    ;;
    x86_64)  CF_ARCH="amd64"  ;;
    *)       CF_ARCH="arm64"  ;;
esac
echo "Arquitectura detectada: $ARCH → $CF_ARCH"

curl -fsSL \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb" \
    -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb
ok "cloudflared $(cloudflared --version 2>&1 | head -1)"

# ── 5. Crear estructura de carpetas ─────────────────────────────────────────
step 5 "Creando estructura de directorios"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DEPLOY_DIR/app"
mkdir -p "$HOME/.cloudflared"
ok "Directorios listos en $DEPLOY_DIR"

# ── 6. Variables de entorno ──────────────────────────────────────────────────
step 6 "Verificando .env.local"
if [ ! -f "$DEPLOY_DIR/app/.env.local" ]; then
    echo -e "${RED}⚠ No se encontró app/.env.local${NC}"
    echo "  Copia tu .env.local a: $DEPLOY_DIR/app/.env.local"
    echo "  Puedes usar env.template como guía"
else
    ok ".env.local encontrado"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║           Setup completado ✓             ║"
echo "╚══════════════════════════════════════════╝${NC}"
echo ""
echo "Próximos pasos:"
echo "  1. Copia el código: (ver instrucciones en GUIA_CLOUDFLARE.md)"
echo "  2. Copia tu .env.local a app/.env.local"
echo "  3. Ejecuta: ./deploy.sh"
