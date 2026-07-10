# PeruvianMarket — Guía de Despliegue

Aplicación de mercados de predicción descentralizados con autenticación real, claves criptográficas y página de ganancias crypto.

## Stack

- **Frontend + API**: Next.js 14 (App Router) + TypeScript
- **Base de datos + Auth**: Supabase (gratis)
- **Hosting**: Vercel (gratis)
- **Crypto**: @noble/secp256k1 (SECP256K1 — igual que Bitcoin)

---

## 1. Supabase — Crear proyecto

1. Ve a [supabase.com](https://supabase.com) → **New project**
2. Elige un nombre (ej: `peruvianmarket`) y región más cercana (São Paulo)
3. Guarda la contraseña de la base de datos

### 1a. Ejecutar migraciones SQL

En el Dashboard de Supabase → **SQL Editor** → pega y ejecuta el contenido de:

```
supabase/migrations/001_init.sql
```

### 1b. Configurar Google OAuth

1. Supabase Dashboard → **Authentication** → **Providers** → **Google**
2. Activa Google OAuth
3. Crea un proyecto en [console.cloud.google.com](https://console.cloud.google.com)
4. Crea credenciales OAuth 2.0 (aplicación web)
5. Agrega como redirect URI:
   ```
   https://[tu-proyecto].supabase.co/auth/v1/callback
   ```
6. Copia el **Client ID** y **Client Secret** a Supabase

### 1c. Obtener tus claves de Supabase

En **Settings** → **API**:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Generar Oracle Key

La clave del Oráculo firma las resoluciones de mercado. Genera una con Node.js:

```bash
node -e "
const { webcrypto } = require('crypto');
const key = webcrypto.getRandomValues(new Uint8Array(32));
console.log('ORACLE_PRIVATE_KEY=' + Buffer.from(key).toString('hex'));
"
```

Guarda el resultado — lo necesitarás en el paso 3.

---

## 3. Variables de entorno

Crea un archivo `.env.local` copiando `.env.local.example` y llenando los valores:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ORACLE_PRIVATE_KEY=tu-clave-de-64-caracteres-hex
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## 4. Instalar y correr en desarrollo

```bash
cd web
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

---

## 5. Desplegar en Vercel

### 5a. Subir a GitHub

```bash
git init
git add .
git commit -m "feat: PeruvianMarket — prediction markets"
git remote add origin https://github.com/tu-usuario/peruvianmarket.git
git push -u origin main
```

### 5b. Conectar Vercel

1. Ve a [vercel.com](https://vercel.com) → **New Project**
2. Importa tu repositorio de GitHub
3. En **Environment Variables** agrega todas las del paso 3
4. Cambia `NEXT_PUBLIC_SITE_URL` por tu URL de Vercel (ej: `https://peruvianmarket.vercel.app`)
5. Click en **Deploy**

### 5c. Configurar Auth redirect en Supabase

1. Supabase → **Authentication** → **URL Configuration**
2. **Site URL**: `https://tu-app.vercel.app`
3. **Redirect URLs**: `https://tu-app.vercel.app/auth/callback`

También en Google OAuth Console → agrega el redirect de producción:
```
https://[tu-proyecto].supabase.co/auth/v1/callback
```

---

## 6. Compartir con amigos

1. Comparte la URL de Vercel con tus amigos
2. Cada amigo se registra con Google o correo
3. En el setup inicial generan su par de claves criptográficas
4. Reclaman 100 PEN del faucet y empiezan a apostar

---

## Flujo del usuario

```
1. Login (Google / Email magic link)
       ↓
2. Setup de wallet (genera par de claves SECP256K1 en el browser)
   - Se muestra la clave privada (solo UNA vez)
   - Se encripta con contraseña del usuario (AES-256-GCM)
   - Se guarda cifrada en localStorage
   - La clave pública + dirección van a Supabase
       ↓
3. Reclama 100 PEN del Faucet
       ↓
4. Apuesta en mercados de predicción
   - Firma cada transacción con su clave privada
   - El servidor verifica la firma SECP256K1
   - AMM (Constant Product Market Maker) ajusta precios
       ↓
5. Gana si predice correctamente (1 share ganador = 1 PEN)
       ↓
6. Earn page → gana más PEN con tareas y aprende sobre crypto real
```

---

## Arquitectura de seguridad

- **Claves privadas**: Nunca salen del browser del usuario
- **Firmas**: Cada transacción es firmada ECDSA (SECP256K1) antes de enviarse
- **Verificación**: El servidor verifica la firma antes de cualquier operación
- **Oráculo**: Ed25519 — solo el servidor puede firmar resoluciones de mercado
- **Nonces**: Previenen double-spending y replay attacks
- **AES-256-GCM**: Encriptación de la clave privada en localStorage

---

## Tier gratuito (límites de Supabase)

| Recurso | Límite gratuito |
|---------|----------------|
| Base de datos | 500 MB |
| Usuarios auth | 50,000/mes |
| API requests | 2M/mes |
| Bandwidth | 5 GB/mes |

Suficiente para un grupo de amigos de hasta ~50 personas.

---

## Preguntas frecuentes

**¿Qué pasa si pierdo mi contraseña?**
Si pierdes la contraseña que cifra tu clave privada, pierdes acceso a tu wallet. El equipo NO puede recuperarla. Por eso se pide hacer un backup del archivo JSON al crear la wallet.

**¿El PEN tiene valor real?**
No. PEN es una moneda virtual de la plataforma para simular mercados. La página "Earn" muestra cómo obtener crypto real (ETH, MATIC, etc.) de faucets de testnet.

**¿Cómo agrego más mercados iniciales?**
Descomenta el bloque al final de `001_init.sql` o créalos directamente desde la app.
