"""
Blockchain module - PeruvianMarket
- Cadena de bloques con Proof-of-Work
- Transacciones firmadas con ECDSA (SECP256K1)
- Tipos de transacción: TRANSFER, FAUCET, CREATE_MARKET, BUY, SELL, RESOLVE, CLAIM
- Mercados de predicción AMM (Constant Product Market Maker)
- Anti-inflación: faucet limitado por dirección + recompensa de minado con halving
"""
import hashlib
import json
import time
import uuid
from typing import List, Dict, Optional
from threading import Lock

from wallet import verify_signature, address_is_valid, public_key_to_address
from oracle import verify_resolution

# ==================== CONFIG ====================
DIFFICULTY = 3                  # Cuántos ceros hex al inicio del hash
INITIAL_BLOCK_REWARD = 50.0     # PEN por bloque
HALVING_INTERVAL = 100          # Cada 100 bloques se reduce la recompensa a la mitad
FAUCET_AMOUNT = 100.0           # Cada dirección puede reclamar 100 PEN UNA SOLA VEZ
INITIAL_LIQUIDITY = 100.0       # PEN que el creador del mercado inyecta como liquidez
MARKET_FEE_BPS = 200            # 2% de fee (200 puntos base) que va al pool de liquidez
TX_VERSION = 1


# ==================== UTILS ====================
def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


# ==================== TRANSACTION ====================
class Transaction:
    """
    Una transacción puede ser de varios tipos.
    Estructura:
      {
        version, type, sender_pubkey, sender_address,
        nonce, timestamp, data {...},
        signature
      }
    """
    @staticmethod
    def build(tx_type: str, sender_pubkey: str, sender_address: str,
              data: dict, nonce: int) -> dict:
        return {
            'version': TX_VERSION,
            'type': tx_type,
            'sender_pubkey': sender_pubkey,
            'sender_address': sender_address,
            'nonce': nonce,
            'timestamp': int(time.time() * 1000),
            'data': data,
        }

    @staticmethod
    def message_to_sign(tx: dict) -> bytes:
        """Mensaje canónico que se firma (sin la firma)"""
        clone = {k: v for k, v in tx.items() if k != 'signature'}
        return canonical_json(clone).encode()

    @staticmethod
    def hash(tx: dict) -> str:
        return sha256_hex(canonical_json(tx).encode())

    @staticmethod
    def verify(tx: dict) -> bool:
        if 'signature' not in tx:
            return False
        # Verifica que el address corresponda al pubkey
        derived = public_key_to_address(bytes.fromhex(tx['sender_pubkey']))
        if derived != tx['sender_address']:
            return False
        msg = Transaction.message_to_sign(tx)
        return verify_signature(tx['sender_pubkey'], tx['signature'], msg)


# ==================== AMM (CPMM) ====================
class AMM:
    """
    Constant Product Market Maker para shares YES/NO.
    Invariante: yes_reserve * no_reserve = k
    Precio de YES (en PEN) = no_reserve / (yes_reserve + no_reserve)
    Precio de NO  (en PEN) = yes_reserve / (yes_reserve + no_reserve)
    Los precios siempre suman 1.

    Implementación tipo Polymarket simplificado:
    - Comprar YES con `pen_in` PEN: el usuario deposita `pen_in` que se añade
      a AMBAS reservas; luego retira shares NO de la reserva NO de modo que
      el invariante se mantenga -> recibe shares YES adicionales.

    Mecánica precisa:
      Sea k = yes * no
      Tras depositar p en ambas: yes' = yes + p, no' = no + p
      Para mantener k: necesitamos sacar `out` shares YES del pool tal que
        (yes + p - out) * (no + p) = k_original_after_fee
      En la versión simétrica de prediction markets:
        out = (yes + p) - k / (no + p)
    """
    @staticmethod
    def price_yes(yes: float, no: float) -> float:
        total = yes + no
        if total == 0:
            return 0.5
        return no / total

    @staticmethod
    def price_no(yes: float, no: float) -> float:
        return 1.0 - AMM.price_yes(yes, no)

    @staticmethod
    def buy_quote(yes: float, no: float, pen_in: float, side: str,
                  fee_bps: int = MARKET_FEE_BPS) -> dict:
        """Cuántas shares se obtienen por `pen_in` PEN"""
        if pen_in <= 0:
            raise ValueError("pen_in must be positive")
        fee = pen_in * fee_bps / 10000.0
        net = pen_in - fee
        k = yes * no
        new_yes = yes + net
        new_no = no + net
        if side == 'YES':
            shares_out = new_yes - (k / new_no)
            new_yes_after = new_yes - shares_out
            new_no_after = new_no
        elif side == 'NO':
            shares_out = new_no - (k / new_yes)
            new_yes_after = new_yes
            new_no_after = new_no - shares_out
        else:
            raise ValueError("side must be YES or NO")
        # Fee se añade a ambas reservas como liquidez
        new_yes_after += fee
        new_no_after += fee
        return {
            'shares_out': shares_out,
            'fee': fee,
            'new_yes': new_yes_after,
            'new_no': new_no_after,
            'avg_price': pen_in / shares_out if shares_out > 0 else 0,
        }

    @staticmethod
    def sell_quote(yes: float, no: float, shares_in: float, side: str,
                   fee_bps: int = MARKET_FEE_BPS) -> dict:
        """Cuántos PEN se reciben por vender `shares_in` shares"""
        if shares_in <= 0:
            raise ValueError("shares_in must be positive")
        k = yes * no
        if side == 'YES':
            # Devuelves shares YES al pool, retiras PEN de ambos
            new_yes = yes + shares_in
            new_no = k / new_yes
            pen_out_gross = no - new_no
        elif side == 'NO':
            new_no = no + shares_in
            new_yes = k / new_no
            pen_out_gross = yes - new_yes
        else:
            raise ValueError("side must be YES or NO")
        if pen_out_gross <= 0:
            raise ValueError("Insufficient liquidity")
        fee = pen_out_gross * fee_bps / 10000.0
        pen_out_net = pen_out_gross - fee
        # Los PEN out salen de ambas reservas equitativamente
        new_yes_after = new_yes - pen_out_net + (fee / 2)
        new_no_after = new_no - pen_out_net + (fee / 2)
        # Aproximación: para mantener simplicidad, reducimos cada lado por pen_out_net
        # y devolvemos la mitad del fee a cada uno
        return {
            'pen_out': pen_out_net,
            'fee': fee,
            'new_yes': max(new_yes_after, 1e-9),
            'new_no': max(new_no_after, 1e-9),
            'avg_price': pen_out_net / shares_in if shares_in > 0 else 0,
        }


# ==================== STATE ====================
class State:
    """
    Estado mutable derivado de aplicar todas las transacciones.
    - balances: address -> PEN
    - nonces: address -> int (siguiente nonce esperado)
    - faucet_claimed: set de addresses que ya reclamaron el faucet
    - markets: market_id -> market dict
    - positions: (address, market_id) -> {'YES': shares, 'NO': shares}
    """
    def __init__(self):
        self.balances: Dict[str, float] = {}
        self.nonces: Dict[str, int] = {}
        self.faucet_claimed = set()
        self.markets: Dict[str, dict] = {}
        self.positions: Dict[str, Dict[str, float]] = {}  # key = "address::market_id"

    def get_balance(self, address: str) -> float:
        return self.balances.get(address, 0.0)

    def get_nonce(self, address: str) -> int:
        return self.nonces.get(address, 0)

    def get_position(self, address: str, market_id: str) -> Dict[str, float]:
        key = f"{address}::{market_id}"
        return self.positions.get(key, {'YES': 0.0, 'NO': 0.0}).copy()

    def _set_position(self, address: str, market_id: str, pos: Dict[str, float]):
        key = f"{address}::{market_id}"
        self.positions[key] = pos

    def snapshot(self) -> dict:
        return {
            'balances': dict(self.balances),
            'nonces': dict(self.nonces),
            'faucet_claimed': list(self.faucet_claimed),
            'markets': {k: dict(v) for k, v in self.markets.items()},
            'positions': {k: dict(v) for k, v in self.positions.items()},
        }


# ==================== BLOCK ====================
class Block:
    @staticmethod
    def build(index: int, prev_hash: str, transactions: List[dict],
              miner_address: str, difficulty: int = DIFFICULTY) -> dict:
        return {
            'index': index,
            'prev_hash': prev_hash,
            'timestamp': int(time.time() * 1000),
            'transactions': transactions,
            'miner_address': miner_address,
            'difficulty': difficulty,
            'nonce': 0,
        }

    @staticmethod
    def hash(block: dict) -> str:
        clone = {k: v for k, v in block.items() if k != 'hash'}
        return sha256_hex(canonical_json(clone).encode())

    @staticmethod
    def mine(block: dict) -> dict:
        target = '0' * block['difficulty']
        while True:
            h = Block.hash(block)
            if h.startswith(target):
                block['hash'] = h
                return block
            block['nonce'] += 1


# ==================== BLOCKCHAIN ====================
class Blockchain:
    def __init__(self, oracle_pubkey: str, admin_pubkey: str = None):
        self.chain: List[dict] = []
        self.mempool: List[dict] = []
        self.oracle_pubkey = oracle_pubkey
        self.admin_pubkey = admin_pubkey  # Solo este pubkey puede CREATE_MARKET (opcional)
        self.lock = Lock()
        self._create_genesis()

    def _create_genesis(self):
        genesis = {
            'index': 0,
            'prev_hash': '0' * 64,
            'timestamp': 0,
            'transactions': [],
            'miner_address': 'GENESIS',
            'difficulty': DIFFICULTY,
            'nonce': 0,
        }
        genesis['hash'] = Block.hash(genesis)
        self.chain.append(genesis)

    @property
    def last_block(self) -> dict:
        return self.chain[-1]

    def current_block_reward(self) -> float:
        height = len(self.chain)
        halvings = height // HALVING_INTERVAL
        return INITIAL_BLOCK_REWARD / (2 ** halvings)

    # ---------- VALIDATION & APPLY ----------
    def _apply_transaction(self, tx: dict, state: State, *, mining_check: bool = True) -> Optional[str]:
        """
        Aplica la transacción al `state`. Retorna None si OK, mensaje de error si falla.
        Si mining_check=False, no verificamos firma (caso del bloque ya minado).
        """
        try:
            sender = tx['sender_address']

            if mining_check:
                if not Transaction.verify(tx):
                    return "Invalid signature"
                expected_nonce = state.get_nonce(sender)
                if tx['nonce'] != expected_nonce:
                    return f"Bad nonce (expected {expected_nonce}, got {tx['nonce']})"

            tx_type = tx['type']
            data = tx['data']

            if tx_type == 'FAUCET':
                if sender in state.faucet_claimed:
                    return "Faucet already claimed"
                state.faucet_claimed.add(sender)
                state.balances[sender] = state.get_balance(sender) + FAUCET_AMOUNT

            elif tx_type == 'TRANSFER':
                to = data['to']
                amount = float(data['amount'])
                if amount <= 0:
                    return "Amount must be positive"
                if not address_is_valid(to):
                    return "Invalid recipient address"
                if state.get_balance(sender) < amount:
                    return "Insufficient balance"
                state.balances[sender] -= amount
                state.balances[to] = state.get_balance(to) + amount

            elif tx_type == 'CREATE_MARKET':
                # Cualquiera puede crear si pone liquidez. Si admin_pubkey está set,
                # solo el admin puede crear.
                if self.admin_pubkey and tx['sender_pubkey'] != self.admin_pubkey:
                    return "Only admin can create markets"
                question = data['question']
                description = data.get('description', '')
                close_timestamp = int(data.get('close_timestamp', 0))
                initial_yes_prob = float(data.get('initial_yes_prob', 0.5))
                liquidity = float(data.get('liquidity', INITIAL_LIQUIDITY))
                if not (0.01 <= initial_yes_prob <= 0.99):
                    return "initial_yes_prob must be in (0.01, 0.99)"
                if liquidity < 10:
                    return "Liquidity must be >= 10 PEN"
                if state.get_balance(sender) < liquidity:
                    return "Insufficient balance for liquidity"
                # Inicializar reservas tal que el precio implícito sea initial_yes_prob
                # price_yes = no / (yes + no) = initial_yes_prob
                # Para liquidez total L: yes + no = 2L (más o menos)
                # Resolvemos: no = initial_yes_prob * (yes + no)
                # Si fijamos yes + no = 2L:  no = 2L * p, yes = 2L * (1-p)
                yes_reserve = 2 * liquidity * (1 - initial_yes_prob)
                no_reserve = 2 * liquidity * initial_yes_prob
                state.balances[sender] -= liquidity

                # Generar market_id determinístico desde el hash de la tx
                market_id = sha256_hex(canonical_json(tx).encode())[:16]
                state.markets[market_id] = {
                    'id': market_id,
                    'question': question,
                    'description': description,
                    'creator': sender,
                    'created_at': tx['timestamp'],
                    'close_timestamp': close_timestamp,
                    'liquidity_provided': liquidity,
                    'yes_reserve': yes_reserve,
                    'no_reserve': no_reserve,
                    'status': 'OPEN',
                    'resolution': None,  # 'YES' / 'NO' cuando se resuelva
                }

            elif tx_type == 'BUY':
                market_id = data['market_id']
                side = data['side']  # 'YES' o 'NO'
                pen_in = float(data['pen_in'])
                min_shares = float(data.get('min_shares', 0))  # slippage protection

                if market_id not in state.markets:
                    return "Market not found"
                m = state.markets[market_id]
                if m['status'] != 'OPEN':
                    return "Market not open"
                if state.get_balance(sender) < pen_in:
                    return "Insufficient balance"

                quote = AMM.buy_quote(m['yes_reserve'], m['no_reserve'], pen_in, side)
                if quote['shares_out'] < min_shares:
                    return "Slippage too high"

                state.balances[sender] -= pen_in
                m['yes_reserve'] = quote['new_yes']
                m['no_reserve'] = quote['new_no']

                pos = state.get_position(sender, market_id)
                pos[side] += quote['shares_out']
                state._set_position(sender, market_id, pos)

            elif tx_type == 'SELL':
                market_id = data['market_id']
                side = data['side']
                shares_in = float(data['shares_in'])
                min_pen = float(data.get('min_pen', 0))

                if market_id not in state.markets:
                    return "Market not found"
                m = state.markets[market_id]
                if m['status'] != 'OPEN':
                    return "Market not open"

                pos = state.get_position(sender, market_id)
                if pos[side] < shares_in:
                    return "Insufficient shares"

                quote = AMM.sell_quote(m['yes_reserve'], m['no_reserve'], shares_in, side)
                if quote['pen_out'] < min_pen:
                    return "Slippage too high"

                pos[side] -= shares_in
                state._set_position(sender, market_id, pos)
                m['yes_reserve'] = quote['new_yes']
                m['no_reserve'] = quote['new_no']
                state.balances[sender] = state.get_balance(sender) + quote['pen_out']

            elif tx_type == 'RESOLVE':
                market_id = data['market_id']
                resolution = data['resolution']  # dict del oráculo
                if not verify_resolution(resolution, self.oracle_pubkey):
                    return "Invalid oracle signature"
                if resolution['payload']['market_id'] != market_id:
                    return "Resolution market_id mismatch"
                if market_id not in state.markets:
                    return "Market not found"
                m = state.markets[market_id]
                if m['status'] != 'OPEN':
                    return "Market already resolved"
                outcome = resolution['payload']['outcome']
                m['status'] = 'RESOLVED'
                m['resolution'] = outcome
                m['resolved_at'] = tx['timestamp']

            elif tx_type == 'CLAIM':
                # Cobrar shares ganadoras de un mercado resuelto. 1 share ganadora = 1 PEN.
                market_id = data['market_id']
                if market_id not in state.markets:
                    return "Market not found"
                m = state.markets[market_id]
                if m['status'] != 'RESOLVED':
                    return "Market not resolved"
                pos = state.get_position(sender, market_id)
                winning_side = m['resolution']
                winnings = pos[winning_side]
                if winnings <= 0:
                    return "No winning shares to claim"
                # Pagar las shares ganadoras desde la reserva del lado opuesto + ganadoras
                # En un AMM ideal con seed correcto, las reservas alcanzan
                m['yes_reserve'] = max(m['yes_reserve'] - (winnings if winning_side == 'YES' else 0), 0)
                m['no_reserve'] = max(m['no_reserve'] - (winnings if winning_side == 'NO' else 0), 0)
                # Pagamos también desde la reserva opuesta proporcionalmente
                # Para simplificar: el creador puso liquidez, y las shares ganadoras se pagan
                # desde la suma total de liquidez restante en el mercado. Las shares perdedoras
                # ya valen 0.
                pos[winning_side] = 0
                pos['YES' if winning_side == 'NO' else 'NO'] = 0  # las perdedoras se queman
                state._set_position(sender, market_id, pos)
                state.balances[sender] = state.get_balance(sender) + winnings

            else:
                return f"Unknown tx type: {tx_type}"

            if mining_check:
                state.nonces[sender] = state.get_nonce(sender) + 1

            return None
        except Exception as e:
            return f"Exception: {e}"

    def compute_state(self) -> State:
        """Recompute estado completo desde el génesis"""
        state = State()
        for block in self.chain[1:]:  # skip genesis
            for tx in block['transactions']:
                # Las recompensas (COINBASE) se aplican aparte
                if tx.get('type') == 'COINBASE':
                    miner = tx['data']['to']
                    amount = tx['data']['amount']
                    state.balances[miner] = state.get_balance(miner) + amount
                    continue
                self._apply_transaction(tx, state, mining_check=False)
                # Avanzamos nonce manualmente porque mining_check=False
                state.nonces[tx['sender_address']] = state.get_nonce(tx['sender_address']) + 1
        return state

    # ---------- MEMPOOL ----------
    def add_to_mempool(self, tx: dict) -> Optional[str]:
        """Valida la tx contra el estado actual + mempool y la añade. Retorna error o None."""
        with self.lock:
            # Simulamos aplicarla sobre el estado proyectado
            projected = self.compute_state()
            for mtx in self.mempool:
                self._apply_transaction(mtx, projected, mining_check=True)
            err = self._apply_transaction(tx, projected, mining_check=True)
            if err:
                return err
            self.mempool.append(tx)
            return None

    # ---------- MINING ----------
    def mine_block(self, miner_address: str, max_txs: int = 50) -> dict:
        with self.lock:
            txs = self.mempool[:max_txs]
            # Coinbase reward
            coinbase = {
                'type': 'COINBASE',
                'data': {'to': miner_address, 'amount': self.current_block_reward()},
                'timestamp': int(time.time() * 1000),
            }
            block_txs = [coinbase] + txs
            block = Block.build(
                index=len(self.chain),
                prev_hash=self.last_block['hash'],
                transactions=block_txs,
                miner_address=miner_address,
            )
            mined = Block.mine(block)
            self.chain.append(mined)
            self.mempool = self.mempool[max_txs:]
            return mined

    # ---------- VALIDATION ----------
    def validate_chain(self) -> bool:
        for i in range(1, len(self.chain)):
            prev = self.chain[i-1]
            curr = self.chain[i]
            if curr['prev_hash'] != prev['hash']:
                return False
            if not curr['hash'].startswith('0' * curr['difficulty']):
                return False
            if Block.hash(curr) != curr['hash']:
                return False
        return True
