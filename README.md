# PeruvianMarket — Informe Técnico

**Proyecto de Criptografía Aplicada · UTEC**

> Plataforma web de mercados de predicción, apuestas P2P privadas y casino entre amigos, construida sobre esquemas criptográficos reales de extremo a extremo. La aplicación no maneja dinero real: es un laboratorio funcional de criptografía aplicada con la economía de un producto completo.

**Demo pública:** desplegada en Raspberry Pi vía Tailscale Funnel (HTTPS).
**Documento complementario:** [`PROYECTO.md`](PROYECTO.md) (resumen ejecutivo) · [`PeruvianMarket-Presentacion.html`](PeruvianMarket-Presentacion.html) (presentación).

---

## 1. Motivación

Un grupo de amigos que quiere apostar entre sí enfrenta tres problemas de confianza que la criptografía resuelve mejor que cualquier acuerdo verbal:

| Problema | Pregunta | Solución criptográfica |
|---|---|---|
| **Custodia** | ¿Quién guarda el dinero y con qué autoridad lo mueve? | Cada usuario posee su par de llaves; toda transferencia exige su **firma ECDSA**. |
| **Privacidad** | ¿Cómo aposto algo personal sin que un tercero (ni el servidor) lo lea? | Términos cifrados con **ECDH + AES-256-GCM** entre las dos partes. |
| **Arbitraje** | ¿Quién decide quién ganó, y cómo lo pruebo? | Veredictos firmados; si hay disputa, un **oráculo Ed25519** resuelve de forma auditable. |
| **Historial** | ¿Cómo demuestro que una operación ocurrió y no fue alterada? | Ledger de transacciones con **hash chaining SHA-256** verificable. |

El objetivo académico es aplicar los primitivos vistos en clase —simétricos, asimétricos, hashes, KDF, firmas, acuerdo de claves— en un caso de uso realista, tomando decisiones concretas de diseño y seguridad.

---

## 2. Descripción del sistema

PeruvianMarket es una aplicación web (Next.js 15) donde los usuarios pueden:

- **Mercados de predicción**: apostar Sí/No con precios dinámicos vía AMM (modelo `x·y=k` de Uniswap/Polymarket) y mercados multi-opción parimutuel.
- **Mercados P2P privados**: apuestas personales 1-a-1 con términos cifrados extremo a extremo, doble depósito en escrow y oráculo de respaldo.
- **Casino**: 7 juegos (Slots, Blackjack, Ruleta, Crash, La Gallina, Minas, Raspa y Gana) con *house edge* configurable.
- **Batallas Pokémon**: motor oficial de Pokémon Showdown (MIT) con apuestas — PvP, vs bot con dificultades, y apuestas de espectadores.
- **Wallet CHCoin (CHC)**: llaves criptográficas propias, transferencias firmadas, backup cifrado.
- **Minería y economía**: clicker con cooldown, SuperChamoCoins desbloqueables, y explorador de blockchain auditable.

### 2.1 Diagrama de arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  NAVEGADOR DEL USUARIO  (toda la criptografía sensible aquí) │
│                                                              │
│   • Genera par de llaves secp256k1 (nunca salen del cliente) │
│   • Firma transacciones y veredictos con ECDSA               │
│   • Cifra la llave privada con AES-256-GCM (bóveda local)    │
│   • Deriva clave ECDH y cifra términos P2P con AES-256-GCM   │
└───────────────────────────┬─────────────────────────────────┘
                            │  HTTPS / TLS 1.3
                            │  (Tailscale Funnel — cert. automático)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  RASPBERRY PI — Next.js 15 (App Router) + PM2                │
│                                                              │
│   • Verifica firmas ECDSA + nonce anti-replay                │
│   • Oráculo firma resoluciones con Ed25519 (llave server)    │
│   • Sella bloques con hash chaining SHA-256                  │
│   • Lógica de AMM, casino, motor Pokémon (en memoria)        │
│   • NUNCA recibe ni almacena llaves privadas de usuarios     │
└───────────────────────────┬─────────────────────────────────┘
                            │  TLS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  SUPABASE  (Postgres + Auth + RLS)                           │
│                                                              │
│   • Cifrado AES-256 en reposo (nivel infraestructura)        │
│   • Contraseñas de cuenta con bcrypt + sesión JWT            │
│   • Row Level Security; el backend usa service role key      │
│   • Almacena SOLO ciphertext de los términos P2P             │
└─────────────────────────────────────────────────────────────┘
```

**Principio de diseño central:** la llave privada de un usuario **nunca abandona su navegador** — ni en claro ni cifrada. El servidor es un verificador de firmas y un ejecutor de lógica, no un custodio.

---

## 3. Componentes criptográficos

Se implementan **cinco primitivas** cubriendo criptografía simétrica, asimétrica, funciones hash, derivación de claves y acuerdo de claves.

### 3.1 Wallets estilo Bitcoin — secp256k1 (asimétrica)

Cada usuario genera su par de llaves en el navegador. La dirección se deriva igual que en Bitcoin (P2PKH), con byte de versión propio `0x35` (prefijo "P"):

```
privKey (32 B, CSPRNG)
   │
   ├─► pubKey comprimida (33 B)
   │
   ├─► hash160 = RIPEMD-160(SHA-256(pubKey))
   │
   ├─► versioned = 0x35 ‖ hash160
   │
   ├─► checksum = SHA-256(SHA-256(versioned))[:4]
   │
   └─► dirección = Base58(versioned ‖ checksum)     →  "N..."
```

El checksum de 4 bytes detecta direcciones mal tipeadas *antes* de mover fondos.
📄 [`web/src/lib/crypto.ts`](web/src/lib/crypto.ts) — `generateWallet()`, `deriveAddress()`

### 3.2 Firma de transacciones — ECDSA

Toda transferencia se firma en el cliente sobre un **JSON canónico** (claves ordenadas alfabéticamente → hash idéntico en cliente y servidor) hasheado con SHA-256:

```
Cliente                          │  Servidor (api/wallet/transfer)
─────────────────────────────────┼──────────────────────────────────
msg   = canonicalJSON(txData)     │  verifySignature(tx, sig, pubKey) ?
hash  = SHA-256(msg)              │      → 401 si falla
sig   = ECDSA_sign(hash, privKey) │  walletOwns(from, pubKey) ?
                                  │      → 401 si la llave no es de la wallet
POST {tx, sig, pubKey} ──────────►│  nonce == currentNonce + 1 ?
                                  │      → 400 (anti-replay)
                                  │  fondos suficientes → débito atómico
```

El mensaje firmado incluye `{type, from, to, amount, nonce, timestamp}`; alterar cualquier campo invalida la firma.
📄 [`web/src/app/api/wallet/transfer/route.ts`](web/src/app/api/wallet/transfer/route.ts)

### 3.3 Bóveda de llave privada — AES-256-GCM + PBKDF2 (simétrica + KDF)

La llave privada se cifra en el navegador antes de tocar disco (`localStorage`):

| Parámetro | Valor | Justificación |
|---|---|---|
| Cifrado | **AES-256-GCM** | Cifrado autenticado: confidencialidad + integridad (tag 128 bits) en una operación. |
| KDF | **PBKDF2-SHA256, 600 000 iteraciones** | Recomendación OWASP 2023; ralentiza fuerza bruta offline. |
| Salt | 16 bytes CSPRNG, único por cifrado | Evita rainbow tables. |
| IV / nonce | 12 bytes CSPRNG, único por cifrado | Nunca se reutiliza con la misma clave (requisito de GCM). |
| Formato | `v2:` + Base64(salt ‖ iv ‖ ciphertext+tag) | Versionado: migración transparente desde blobs legacy de 100k iteraciones. |

El servidor **nunca ve** este blob. Sin la contraseña maestra es inútil, y GCM detecta cualquier manipulación del ciphertext.
📄 [`web/src/lib/crypto.ts`](web/src/lib/crypto.ts) — `encryptPrivateKey()`, `decryptPrivateKey()`

### 3.4 Mercados P2P privados — ECDH + AES-GCM + doble firma (cifrado híbrido)

El aporte más completo del proyecto: apuestas personales con **privacidad extremo a extremo**. Ambas partes derivan la misma clave simétrica **sin transmitirla jamás**:

```
   Alice (creadora)                         Bob (retado)
   ────────────────                         ────────────
   ECDH(privA, pubB) ──┐              ┌──── ECDH(privB, pubA)
                       ├─ mismo punto ─┤
                       ▼              ▼
              SHA-256(coordenada X del punto compartido)
                       │              │
                       ▼              ▼
              clave AES-256 idéntica en ambos lados
```

**Protocolo completo:**

```
1. CREAR   Alice cifra los términos con AES-256-GCM (clave ECDH)
           terms_hash = SHA-256(ciphertext)
           firma ECDSA sobre {P2P_CREATE, from, to, amount, terms_hash, deadline, nonce, ts}
           → deposita su parte en escrow. El servidor guarda SOLO ciphertext.

2. ACEPTAR Bob descifra localmente (ECDH simétrico), revisa los términos
           firma ECDSA sobre el MISMO terms_hash → ambas firmas prueban
           acuerdo sobre términos idénticos (no repudio)
           → deposita su parte. Pot en escrow (2× amount).

3. VEREDICTO  Cada parte firma su veredicto (P2P_VERDICT).
           coinciden → pago automático al ganador (claim condicional)
           difieren  → estado "disputa"

4. ORÁCULO Si hay disputa o vence el plazo sin resolución, el oráculo
           resuelve y FIRMA con Ed25519. La firma queda auditable.
```

📄 [`web/src/lib/crypto.ts`](web/src/lib/crypto.ts) (`deriveSharedKey`, `encryptShared`) · [`web/src/lib/p2p.ts`](web/src/lib/p2p.ts) · [`web/src/app/p2p/page.tsx`](web/src/app/p2p/page.tsx)

### 3.5 Oráculo de resoluciones — Ed25519 (asimétrica)

Cuando un mercado (predicción o P2P en disputa) se resuelve, el oráculo firma el resultado:

```
mensaje = "p2p:{marketId}:{winnerAddress}:{timestamp}"
firma   = Ed25519_sign(mensaje, ORACLE_PRIVATE_KEY)   // solo en .env del servidor
```

**¿Por qué Ed25519 y no ECDSA de nuevo?**
- **Firmas deterministas**: sin nonce aleatorio por firma, eliminando toda una clase de fallas que rompió wallets y consolas con ECDSA mal implementado.
- **Verificación pública**: la llave pública del oráculo se expone; cualquiera valida que una resolución es auténtica.
- **Separación de dominios**: los usuarios firman con secp256k1, el árbitro con Ed25519 — una llave comprometida no cruza roles.

📄 [`web/src/lib/oracle.ts`](web/src/lib/oracle.ts) · [`web/src/app/api/admin/p2p/route.ts`](web/src/app/api/admin/p2p/route.ts)

### 3.6 Blockchain con hash chaining — SHA-256

Las transacciones se sellan en bloques de 5. El hash de cada bloque cubre el hash del bloque anterior y el contenido de sus transacciones:

```
block_hash = SHA-256( número | prev_hash | tx₁:tipo:from:to:monto ; tx₂ … tx₅ )
```

Alterar **cualquier** transacción sellada o bloque rompe la cadena desde ese punto. El explorador incluye un botón **"Verificar cadena"** que recomputa todos los hashes y reporta el primer bloque inválido si la BD fue manipulada.
📄 [`web/src/lib/blockchain.ts`](web/src/lib/blockchain.ts) · endpoint `/api/blockchain/verify`

---

## 4. Justificación de librerías

Se usan exclusivamente librerías probadas y auditadas; **no se implementó ningún primitivo criptográfico desde cero** (requisito del curso).

| Librería | Uso | Por qué |
|---|---|---|
| `@noble/secp256k1` | ECDSA (firmas) + ECDH (acuerdo de claves) | Auditada independientemente; usada en producción por MetaMask y otros. |
| `@noble/ed25519` | Firmas del oráculo | Misma familia `@noble`, minimalista y sin dependencias. |
| `@noble/hashes` | SHA-256, SHA-512, RIPEMD-160, HMAC | Implementaciones constantes en tiempo, revisadas. |
| **WebCrypto** (`crypto.subtle`) | AES-256-GCM + PBKDF2 | Primitivos **nativos del navegador**, no reimplementados en JS. |
| `@pkmn/sim`, `@pkmn/randoms` | Motor de batallas Pokémon | Código oficial de Pokémon Showdown (MIT). |

Todos los algoritmos siguen estándares actuales: no se usan hashes rotos (MD5, SHA-1) ni esquemas débiles (DES, ECB).

---

## 5. Análisis de amenazas

| Amenaza | Defensa | Estado |
|---|---|---|
| Intercepción de tráfico | TLS 1.3 extremo a extremo; la llave privada nunca viaja | **Mitigado** |
| Replay de una transacción firmada | Nonce monotónico dentro del mensaje firmado | **Mitigado** |
| Resolución de mercado falsificada | Firma Ed25519 del oráculo, verificable públicamente | **Mitigado** |
| Fuga completa de la base de datos | Sin llaves privadas que robar; contraseñas bcrypt; firmas no reutilizables | **Mitigado** |
| Servidor espía apuestas privadas P2P | Cifrado E2E ECDH + AES-GCM: el servidor solo almacena ciphertext | **Mitigado** |
| Una parte niega el acuerdo P2P | Ambas firmas ECDSA ancladas a `SHA-256(ciphertext)` — no repudio | **Mitigado** |
| Admin malicioso edita el historial | Hash chaining SHA-256: cualquier alteración rompe la cadena y la verificación la delata | **Mitigado** |
| Doble gasto / doble cobro (concurrencia) | Débito atómico `try_debit` + claims condicionales por estado | **Mitigado** |
| XSS exfiltra el blob cifrado de la llave | AES-GCM + PBKDF2 ×600k → solo fuerza bruta offline contra la contraseña | **Depende de la contraseña** |

### Análisis estático de seguridad

Se aplicaron dos escáneres complementarios (evidencia en [`seguridad/`](seguridad/)):

| Herramienta | Qué analiza | Resultado |
|---|---|---|
| **Semgrep** (SAST) | Patrones inseguros en el código fuente (ruleset `p/security-audit`) | **0 hallazgos** · 22 reglas · 88 archivos |
| **npm audit** | Vulnerabilidades conocidas (CVE/GHSA) en dependencias | **0 vulnerabilidades** |
| `tsc --noEmit` | Análisis estático de tipos | 0 errores |

---

## 6. Limitaciones conocidas

- **Casino custodial**: las apuestas de los juegos de casino se autorizan por sesión JWT, no por firma ECDSA (decisión de UX para partidas rápidas). Las transferencias de fondos y los mercados P2P **sí** exigen firma.
- **Batallas Pokémon en memoria**: el estado de combate vive en la RAM del proceso; si el servidor reinicia a mitad de una batalla, esta se cancela y ambos recuperan su apuesta (detectado automáticamente, sin pérdida de fondos).
- **Oráculo centralizado**: el árbitro de disputas es una única llave Ed25519 controlada por el administrador. Un esquema de umbral (t-de-n) sería más robusto pero excede el alcance.
- **KDF**: PBKDF2 ×600k cumple OWASP 2023, pero **Argon2id** (resistente a GPU/ASIC) sería superior; se dejó como trabajo futuro por disponibilidad en WebCrypto.

---

## 7. Evaluación de resultados

- ✅ **Cinco primitivas criptográficas** funcionando en un producto real desplegado y público: ECDSA, ECDH, Ed25519, AES-256-GCM y PBKDF2, más hashes SHA-256/512 y RIPEMD-160.
- ✅ **Cifrado híbrido completo** (KEM/DEM conceptual): ECDH acuerda la clave, AES-GCM cifra los datos — el caso de los mercados P2P privados.
- ✅ **No repudio y privacidad extremo a extremo** demostrables en vivo: se puede abrir la base de datos y mostrar que los términos son ilegibles, luego descifrarlos en la interfaz con la contraseña del usuario.
- ✅ **Concurrencia segura**: operaciones de dinero atómicas, verificadas para soportar múltiples usuarios apostando simultáneamente.
- ✅ **Auditabilidad**: blockchain con verificación de integridad de un clic.

**Fallas y aprendizajes**: la primera versión de la "blockchain" usaba hashes falsos derivados del ID de transacción (agrupación visual, sin garantía real); se corrigió a hash chaining verdadero. El límite de memoria de PM2 causaba reinicios que cancelaban batallas Pokémon; se diagnosticó y ajustó. Ambos casos ilustran la diferencia entre "parece criptográfico" y "es criptográficamente sólido".

---

## 8. Stack y despliegue

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Base de datos**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Raspberry Pi + PM2, expuesta a internet con Tailscale Funnel (HTTPS gratuito, sin abrir puertos del router)

### Correr localmente

```bash
cd web
npm install
cp .env.local.example .env.local   # completar credenciales de Supabase
npm run dev                         # http://localhost:3000
```

### Migraciones SQL

Los scripts en [`web/sql/`](web/sql/) crean las tablas necesarias (mercados, bloques, P2P, Pokémon, funciones atómicas). Ejecutarlos en el SQL Editor de Supabase.

### Despliegue en Raspberry Pi

Guías paso a paso en [`deploy-rpi/`](deploy-rpi/): `setup.sh` (instala Node, PM2, cloudflared), `deploy.sh` (build + arranque), y guías de Tailscale Funnel y Cloudflare Tunnel.

> ⚠️ **Nota de seguridad**: `web/.env.local` (llaves de Supabase, llave privada del oráculo) y cualquier `*_key.json` **no están versionados** — deben copiarse manualmente o recrearse desde las plantillas.

---

## 9. Estructura del repositorio

```
proyecto11/
├── web/                          # Aplicación Next.js
│   ├── src/lib/
│   │   ├── crypto.ts             # secp256k1, ECDH, AES-GCM, PBKDF2, direcciones
│   │   ├── oracle.ts             # firmas Ed25519 del oráculo
│   │   ├── p2p.ts                # lógica de mercados P2P
│   │   ├── blockchain.ts         # hash chaining SHA-256
│   │   └── casino-bank.ts        # operaciones de balance atómicas
│   ├── src/app/api/              # rutas de backend (wallet, p2p, casino, pokemon…)
│   ├── src/app/                  # páginas (markets, p2p, casino, wallet…)
│   └── sql/                      # migraciones de base de datos
├── deploy-rpi/                   # scripts y guías de despliegue en Raspberry Pi
├── peruvianmarket/               # prototipo previo en Python (referencia)
├── PROYECTO.md                   # resumen ejecutivo
├── PeruvianMarket-Presentacion.html  # presentación (abrir en navegador)
└── README.md                     # este informe
```

---

*Proyecto académico. No maneja dinero real. Los nombres y sprites de Pokémon son propiedad de Nintendo/The Pokémon Company; su uso aquí es sin fines de lucro, en el mismo espíritu que Pokémon Showdown.*
