# PeruvianMarket 🇵🇪

**Mercados de predicción y casino entre amigos, construidos sobre criptografía real de extremo a extremo.**

> Proyecto del curso de Criptografía — UTEC · Demo pública: `https://bot.tail48662d.ts.net`

---

## ¿Qué es?

PeruvianMarket es una plataforma web donde un grupo de amigos puede:

- **Apostar en mercados de predicción** ("¿Perú clasifica al Mundial 2026?") con precios dinámicos vía AMM (mismo modelo x·y=k de Uniswap/Polymarket)
- **Crear mercados P2P privados**: apuestas personales 1-a-1 con términos **cifrados extremo a extremo (ECDH + AES-GCM)**, doble depósito en escrow, doble firma ECDSA, y oráculo Ed25519 como árbitro de respaldo
- **Jugar en un casino** con 7 juegos: Slots, Blackjack, Ruleta, Crash, La Gallina, Minas y Raspa y Gana — todos con house edge configurable
- **Batallar Pokémon** (motor oficial de Showdown): PvP random o con equipos propios, vs bot con 3 dificultades, y apuestas de espectadores en vivo (parimutuel)
- **Gestionar una wallet propia** de CHCoins (CHC) con llaves criptográficas reales que solo el usuario controla
- **Minar CHC** con un clicker con cooldown, y desbloquear el minado de **SuperChamoCoins (SCC)** al superar los 5,000,000 CHC
- **Auditar todo** en un explorador de blockchain con bloques encadenados por SHA-256 y verificación de integridad en un clic

No es dinero real: es un laboratorio funcional de criptografía aplicada con la economía de un producto real.

---

## Arquitectura

```
Navegador del usuario
│  · genera par de llaves secp256k1 (nunca salen de aquí)
│  · firma transacciones con ECDSA
│  · cifra la llave privada con AES-256-GCM
▼  TLS (Tailscale Funnel)
Raspberry Pi — Next.js 15
│  · verifica firmas ECDSA + nonce anti-replay
│  · oráculo Ed25519 firma resoluciones de mercados
│  · sella bloques con hash chaining SHA-256
│  · lógica AMM, casino, minería
▼  TLS
Supabase (Postgres + Auth)
   · AES-256 at rest · bcrypt para contraseñas · JWT de sesión · RLS
```

---

## Componentes criptográficos

### 1. Wallets estilo Bitcoin — secp256k1 (asimétrica)

Cada usuario genera su par de llaves **en el navegador**. La dirección se deriva igual que en Bitcoin P2PKH:

```
privKey (32B CSPRNG) → pubKey comprimida (33B)
→ RIPEMD-160(SHA-256(pubKey)) → 0x35 ‖ hash160 ("P...")
→ checksum = SHA-256²[:4] → Base58
```

El checksum de 4 bytes detecta direcciones mal tipeadas antes de enviar fondos.
📄 `web/src/lib/crypto.ts`

### 2. Transferencias firmadas — ECDSA

Toda transferencia se firma en el cliente sobre un **JSON canónico** (claves ordenadas → hash idéntico en cliente y servidor) hasheado con SHA-256. El servidor verifica: firma válida → llave pública pertenece a la wallet emisora → **nonce monotónico** (anti-replay) → fondos suficientes. El débito usa lock optimista y el crédito es atómico (RPC).
📄 `web/src/app/api/wallet/transfer/route.ts`

### 3. Bóveda de llave privada — AES-256-GCM + PBKDF2 (simétrica)

La llave privada se cifra en el navegador antes de tocar disco:

| Parámetro | Valor |
|---|---|
| Cifrado | AES-256-GCM (autenticado — cifra + sella integridad) |
| KDF | PBKDF2-SHA256, **600,000 iteraciones** (OWASP 2023) |
| Salt | 16 bytes CSPRNG, único por cifrado |
| IV/nonce | 12 bytes CSPRNG, único por cifrado |
| Formato | `v2:` + Base64(salt ‖ iv ‖ ciphertext+tag) |

El servidor **nunca ve la llave privada** — ni en claro ni cifrada.
📄 `web/src/lib/crypto.ts`

### 4. Oráculo de resoluciones — Ed25519 (asimétrica)

Cuando un mercado se resuelve, el oráculo firma `marketId:outcome:timestamp` con Ed25519. La firma queda persistida y cualquiera puede verificarla contra la llave pública del oráculo. Ed25519 usa firmas deterministas (sin nonce aleatorio frágil) y separa el dominio del árbitro del de los usuarios.
📄 `web/src/lib/oracle.ts`

### 5. Mercados P2P privados — ECDH + AES-GCM + doble firma (cifrado híbrido)

Apuestas personales entre dos wallets con **privacidad extremo a extremo**:

```
A: ECDH(privA, pubB) ──┐
                       ├─→ SHA-256 → misma clave AES-256 (sin intercambiarla jamás)
B: ECDH(privB, pubA) ──┘
```

1. **A cifra los términos** con la clave compartida (AES-256-GCM) y **firma con ECDSA** sobre `SHA-256(ciphertext)` — el servidor solo almacena texto cifrado que no puede leer
2. **B descifra** localmente (ECDH es simétrico), revisa los términos y **firma su aceptación sobre el mismo hash**: ambas firmas prueban acuerdo sobre términos idénticos
3. Ambos depósitos quedan en **escrow**; cada parte firma su **veredicto** — si coinciden, el pot se libera automáticamente
4. Si los veredictos difieren o vence el plazo, el **oráculo Ed25519** resuelve y su firma queda auditable en el mercado

📄 `web/src/lib/crypto.ts` (ECDH) · `web/src/lib/p2p.ts` · `/p2p`

### 6. Blockchain con hash chaining — SHA-256

Las transacciones se sellan en bloques de 5. El hash de cada bloque cubre:

```
block_hash = SHA-256(número | prev_hash | tx₁:tipo:from:to:monto ; tx₂… )
```

Alterar **cualquier** transacción sellada o bloque rompe la cadena desde ese punto. El explorador incluye un botón **"Verificar cadena"** que recomputa todos los hashes y reporta el primer bloque inválido si alguien manipuló la BD.
📄 `web/src/lib/blockchain.ts` · `/api/blockchain/verify`

### 7. Autenticación y transporte

- **Supabase Auth**: contraseñas con bcrypt, sesiones JWT, verificadas en cada API route
- **TLS extremo a extremo**: certificado HTTPS emitido por Tailscale Funnel
- **Postgres cifrado AES-256 at rest** a nivel infraestructura

---

## Librerías criptográficas (todas probadas, nada desde cero)

| Librería | Uso |
|---|---|
| `@noble/secp256k1` | ECDSA (firmas) + **ECDH** (acuerdo de claves P2P) |
| `@noble/ed25519` | Firmas del oráculo |
| `@noble/hashes` | SHA-256, SHA-512, RIPEMD-160, HMAC |
| WebCrypto (`crypto.subtle`) | AES-256-GCM + PBKDF2 nativos del navegador |
| `@pkmn/sim` + `@pkmn/randoms` | Motor oficial de Pokémon Showdown (MIT) para batallas |

Las librerías `@noble` son auditadas de forma independiente y ampliamente usadas en producción (MetaMask, entre otros).

---

## Funcionalidades

| Módulo | Detalle |
|---|---|
| 📈 Mercados | Sí/No con AMM x·y=k · multi-opción parimutuel · probabilidades oracle |
| 🤝 P2P privados | Apuestas 1-a-1 cifradas E2E (ECDH+AES-GCM) · doble escrow · doble firma · oráculo de respaldo |
| 🎰 Casino | Slots, Blackjack (3:2/6:5), Ruleta europea, Crash, La Gallina, Minas, Raspa y Gana |
| ⚔️ Pokémon | Showdown Gen 9: PvP random/equipos · vs bot (paga 1.5×/2.2×/3.5×) · Team Builder · apuestas de espectadores |
| ⚙️ Admin | House edge y RTP por juego, mercados, tareas, sugerencias, oráculo P2P |
| 👛 Wallet | Transferencias firmadas, historial, faucet, backup cifrado de llaves |
| ⛏️ Minería | Clicker con cooldown configurable · SCC desbloqueable a los 5M CHC |
| ⛓️ Explorador | Bloques encadenados, feed en vivo, verificación de integridad |

---

## Stack técnico

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript + Tailwind
- **Base de datos**: Supabase (Postgres + Auth + RLS)
- **Hosting**: Raspberry Pi + PM2, expuesta a internet con Tailscale Funnel (HTTPS gratuito, sin abrir puertos)

## Cómo correr localmente

```bash
cd web
npm install
cp .env.local.example .env.local   # completar credenciales de Supabase
npm run dev                         # http://localhost:3000
```

---

## Análisis de amenazas (resumen)

| Amenaza | Mitigación |
|---|---|
| Intercepción de tráfico | TLS; la llave privada nunca viaja |
| Replay de transacciones | Nonce monotónico dentro del mensaje firmado |
| Resolución falsificada | Firma Ed25519 verificable del oráculo |
| Fuga de la BD | Sin llaves privadas; contraseñas bcrypt; alteraciones rompen la cadena de bloques |
| XSS roba el blob cifrado | AES-GCM + PBKDF2 ×600k → solo fuerza bruta offline contra la contraseña |
| Servidor espía apuestas privadas P2P | Cifrado E2E: ECDH + AES-GCM — el servidor solo almacena ciphertext |
| Una parte niega el acuerdo P2P | Ambas firmas ECDSA ancladas a SHA-256(ciphertext) — no repudio |

**Limitación conocida**: las apuestas de casino son custodiales (autorizadas por sesión JWT, no por firma ECDSA) — decisión de UX para partidas rápidas; las transferencias de fondos sí exigen firma.

---

## Roadmap (feedback de usuarios)

- 🎨 Animaciones y efectos de sonido en los juegos del casino
- 🚀 Optimización de rendimiento y fluidez general
- 💰 ~~Montos de apuesta personalizados y límites ampliados~~ ✅
- 🔧 ~~Corrección de errores en transferencias entre wallets~~ ✅
- ⚡ ~~SuperChamoCoins con minado desbloqueable a 5M CHC~~ ✅
