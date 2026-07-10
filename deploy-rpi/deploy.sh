#!/bin/bash
# =============================================================================
# deploy.sh — Ejecutar después de copiar el código al Pi
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${YELLOW}[$1/4] $2...${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$DEPLOY_DIR/app"

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║     Peruvian Market — Deploy             ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Verificaciones previas ───────────────────────────────────────────────────
if [ ! -d "$APP_DIR" ] || [ -z "$(ls -A $APP_DIR)" ]; then
    echo -e "${RED}✗ La carpeta app/ está vacía.${NC}"
    echo "  Desde tu PC Windows, ejecuta primero:"
    echo "  (ver sección 'Enviar el código' en GUIA_CLOUDFLARE.md)"
    exit 1
fi

if [ ! -f "$APP_DIR/.env.local" ]; then
    echo -e "${RED}✗ Falta app/.env.local${NC}"
    echo "  Copia tu archivo .env.local a $APP_DIR/.env.local"
    exit 1
fi

if [ ! -f "$APP_DIR/package.json" ]; then
    echo -e "${RED}✗ No se encontró package.json en app/${NC}"
    echo "  Asegúrate de que el código esté en la carpeta app/"
    exit 1
fi

# ── 1. Deshabilitar telemetría ───────────────────────────────────────────────
step 1 "Configurando entorno"
export NEXT_TELEMETRY_DISABLED=1
# Detectar RAM para ajustar heap de Node
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if   [ "$TOTAL_RAM_MB" -ge 3500 ]; then NODE_HEAP=1024
elif [ "$TOTAL_RAM_MB" -ge 1800 ]; then NODE_HEAP=768
else                                     NODE_HEAP=512
fi
echo "RAM detectada: ${TOTAL_RAM_MB}MB → Node heap: ${NODE_HEAP}MB"
export NODE_OPTIONS="--max-old-space-size=${NODE_HEAP}"
ok "NODE_OPTIONS=$NODE_OPTIONS"

# ── 2. Instalar dependencias ─────────────────────────────────────────────────
step 2 "Instalando dependencias npm"
cd "$APP_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
ok "Dependencias instaladas"

# ── 3. Build de producción ───────────────────────────────────────────────────
step 3 "Compilando Next.js para producción (puede tardar 5-10 min en RPi)"
cd "$APP_DIR"
npm run build
ok "Build completado"

# ── 4. Iniciar con PM2 ──────────────────────────────────────────────────────
step 4 "Iniciando app con PM2"
cd "$DEPLOY_DIR"

# Si ya existe el proceso, reiniciarlo; si no, crearlo
if pm2 list | grep -q "peruvianmarket"; then
    pm2 restart peruvianmarket
    ok "App reiniciada"
else
    pm2 start ecosystem.config.js --env production
    ok "App iniciada"
fi

pm2 save
ok "Configuración PM2 guardada (persiste al reiniciar)"

# ── Resultado ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║        Deploy completado ✓               ║"
echo "╚══════════════════════════════════════════╝${NC}"
echo ""
pm2 list
echo ""
echo "App corriendo en: http://localhost:3000"
echo ""
echo "Comandos útiles:"
echo "  pm2 logs peruvianmarket     # Ver logs en tiempo real"
echo "  pm2 restart peruvianmarket  # Reiniciar"
echo "  pm2 stop peruvianmarket     # Detener"
echo ""
echo "Para exponer al internet: ver GUIA_CLOUDFLARE.md → Paso 3"
