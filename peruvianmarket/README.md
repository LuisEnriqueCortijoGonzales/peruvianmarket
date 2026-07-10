# PeruvianMarket — Polymarket peruano (PoC)

Prueba de concepto **100% funcional** de un mercado de predicciones tipo Polymarket
construido sobre una **blockchain propia** en Python con criptografía implementada
desde cero (SECP256K1 estilo Bitcoin para wallets, Ed25519 para el oráculo, PoW
para minado).

---

## Lo que cumple

- **Blockchain simple**: cadena con bloques enlazados por hash, mempool, prueba de
  trabajo (3 ceros hex), validación completa, detección de tampering.
- **Criptografía propia**:
  - Wallets estilo Bitcoin: clave privada SECP256K1 → pubkey → SHA256+RIPEMD160 →
    base58check con version byte `0x35` (todas las direcciones empiezan con `N`).
  - Firmas ECDSA en cada transacción, verificadas por la cadena.
  - Oráculo con clave Ed25519 que firma resoluciones; la cadena rechaza
    cualquier `RESOLVE` con firma inválida o tampered.
- **Mercados estilo Polymarket** con AMM (CPMM tipo Uniswap):
  - Admin crea apuesta con probabilidad inicial (ej. 51/49).
  - Usuarios compran/venden YES o NO dinámicamente; el precio fluctúa.
  - Fee del 2% que regresa al pool de liquidez.
  - Al resolver, las shares ganadoras valen 1 PEN, las perdedoras 0.
- **Registro tipo Bitcoin**: el "registro" es generar una clave privada en el
  navegador. No hay login. La clave nunca sale del cliente; las firmas se hacen
  localmente con `noble-secp256k1` (bundleado en `frontend/crypto.bundle.js`).
- **Anti-inflación**:
  - Coins entran solo por (a) **minar bloques** (recompensa decreciente con
    halving cada 100 bloques, parte de 50 PEN) o (b) **faucet** de 100 PEN
    **una sola vez por dirección** (controlado por la cadena).
  - Las shares perdedoras al resolver un mercado se queman.

---

## Cómo correr

### 1. Dependencias

```bash
cd backend
pip install flask flask-cors ecdsa pynacl cryptography
```

### 2. Levantar el servidor

```bash
cd backend
python server.py
```

Eso arranca:
- API Flask en `http://localhost:5000`
- Frontend servido desde la misma URL
- Auto-miner en thread aparte (mina cuando hay tx en mempool)
- Oráculo: genera o carga `oracle_key.json` automáticamente

### 3. Abrir el frontend

Navegar a **http://localhost:5000**

Vistas disponibles:
- **Mercados**: ver y operar en los mercados abiertos
- **Wallet**: generar/importar wallet, pedir faucet, transferir, ver posiciones
- **Crear**: form para que un admin cree un mercado con probabilidad inicial
- **Oráculo**: resolver mercados (en este PoC abierto a cualquiera; en producción
  esta UI estaría protegida)
- **Cadena**: explorador de bloques, mempool, validación

---

## Flujo típico de prueba

1. Ir a **Wallet** → "Generar nueva wallet" → guardar la clave privada.
2. Click en "Pedir faucet" → recibir 100 PEN.
3. Ir a **Crear** → crear un mercado (ej. "¿Universitario será campeón?", prob
   inicial 0.40, liquidez 50 PEN).
4. Generar otra wallet en otra pestaña, pedir faucet, ir a **Mercados** y comprar
   YES o NO. La probabilidad fluctúa.
5. Ir a **Oráculo** → resolver el mercado YES o NO.
6. Volver a **Wallet** → click en "Reclamar" sobre la posición ganadora → recibir
   1 PEN por share.
7. **Cadena**: revisar los bloques, ver que la cadena valida.

---

## Tests

```bash
cd backend
python test_e2e.py
```

Ese test cubre, sin tocar HTTP, el flujo completo:
- Generación de wallets, faucets (y rechazo de doble-faucet)
- Creación de mercado, compra YES/NO, venta
- Firma del oráculo, rechazo de resolución tampered
- Resolución, claim ganador, rechazo de claim perdedor
- Validación de cadena, rechazo de doble gasto

---

## Estructura

```
peruvianmarket/
├── backend/
│   ├── wallet.py        # SECP256K1, base58check, hash160
│   ├── oracle.py        # Oráculo Ed25519
│   ├── blockchain.py    # Tx, AMM, Block, Blockchain, validación
│   ├── server.py        # Flask + auto-miner + sirve frontend
│   └── test_e2e.py      # Test end-to-end Python puro
├── frontend/
│   ├── index.html       # 5 vistas
│   ├── style.css        # Estética editorial peruana (terracota/mostaza/negro)
│   ├── app.js           # Lógica cliente, fetch API
│   └── crypto.bundle.js # noble-secp256k1 bundleado (firma client-side)
└── README.md
```

---

## Detalles técnicos relevantes

- **JSON canónico**: para que las firmas sean compatibles entre Python y JS, se
  usa `sort_keys=True, separators=(',',':'), ensure_ascii=False`. Esto importa
  cuando las preguntas tienen tildes o `¿`/`?`.
- **Formato de firma ECDSA**: `r || s` (64 bytes), compatible entre
  `python-ecdsa` (`SigningKey.sign(...)`) y `noble-secp256k1`
  (`signAsync(...).toCompactRawBytes()`).
- **Address derivation**: `SHA256(pubkey_compressed) → RIPEMD160 → version=0x35
  → checksum=SHA256(SHA256(...))[:4] → base58`. Todas las direcciones empiezan
  con `N`.
- **AMM**: `precio_YES = no_reserve / (yes_reserve + no_reserve)`. Comprar YES
  agrega PEN al pool y retira yes_shares manteniendo `k = yes * no` constante
  (descontando fee).

---

## Lo que NO incluye (siguiente iteración)

- Roles / permisos (cualquiera puede resolver mercados desde la UI del oráculo).
- Persistencia de la cadena entre reinicios (vive en memoria; las wallets sí
  persisten en `wallets/`).
- Firma multi-sig del oráculo, time-locks, disputas.
- Reentrancia / pruebas adversariales más allá de los casos del test e2e.
