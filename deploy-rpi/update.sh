#!/bin/bash
# =============================================================================
# update.sh — Para actualizaciones futuras del código
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$DEPLOY_DIR/app"

echo -e "${YELLOW}=== Actualización de Peruvian Market ===${NC}"
echo ""
echo "Desde tu PC Windows (Git Bash / PowerShell con OpenSSH):"
echo ""
echo -e "${GREEN}  # Windows — Git Bash:${NC}"
echo "  rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.git' \\"
echo "    /c/Users/lecor/Documents/utec/crypto/proyecto11/web/ \\"
echo "    pi@<IP_DEL_PI>:~/peruvianmarket/app/"
echo ""
echo -e "${GREEN}  # Windows — PowerShell (alternativa zip):${NC}"
echo "  # 1. En Windows: comprimir web/ sin node_modules con 7-Zip"
echo "  # 2. scp app.zip pi@<IP_DEL_PI>:~/peruvianmarket/"
echo "  # 3. En el Pi: cd ~/peruvianmarket && unzip -o app.zip -d app/"
echo ""
read -p "¿Ya copiaste los archivos nuevos? (s/n): " confirm
if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
    echo "Cancela, envía los archivos y vuelve a ejecutar este script."
    exit 0
fi

# Detectar RAM
TOTAL_RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if   [ "$TOTAL_RAM_MB" -ge 3500 ]; then NODE_HEAP=1024
elif [ "$TOTAL_RAM_MB" -ge 1800 ]; then NODE_HEAP=768
else                                     NODE_HEAP=512
fi

export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=${NODE_HEAP}"

echo -e "${YELLOW}[1/3] Instalando dependencias...${NC}"
cd "$APP_DIR"
npm ci --prefer-offline 2>/dev/null || npm install

echo -e "${YELLOW}[2/3] Compilando...${NC}"
npm run build

echo -e "${YELLOW}[3/3] Reiniciando...${NC}"
pm2 restart peruvianmarket
pm2 save

echo -e "${GREEN}✓ Actualización completada${NC}"
pm2 list
