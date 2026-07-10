"""
PeruvianMarket Server
- Expone API REST sobre la blockchain
- Endpoints: wallet info, mempool, mining, markets, oracle
"""
import os
import json
import threading
import time
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from blockchain import Blockchain, Transaction, AMM, FAUCET_AMOUNT, INITIAL_LIQUIDITY
from oracle import Oracle
from wallet import Wallet, address_is_valid

# ==================== INIT ====================
oracle = Oracle.load_or_create()
blockchain = Blockchain(oracle_pubkey=oracle.public_key_hex, admin_pubkey=None)

app = Flask(__name__, static_folder=None)
CORS(app)

# Auto-mining (background) - mina cada vez que hay txs en mempool
AUTO_MINE = True
MINER_WALLET = Wallet.generate()  # wallet del minero del nodo
print(f"[NODE] Miner address: {MINER_WALLET.address}")
print(f"[NODE] Oracle pubkey: {oracle.public_key_hex}")


def auto_miner_loop():
    while True:
        try:
            if AUTO_MINE and len(blockchain.mempool) > 0:
                blockchain.mine_block(MINER_WALLET.address)
                print(f"[MINER] Mined block #{len(blockchain.chain)-1}")
        except Exception as e:
            print(f"[MINER] Error: {e}")
        time.sleep(2)


threading.Thread(target=auto_miner_loop, daemon=True).start()


# ==================== HELPERS ====================
def err(msg, code=400):
    return jsonify({'error': msg}), code


# ==================== ENDPOINTS ====================
@app.route('/api/info')
def info():
    state = blockchain.compute_state()
    return jsonify({
        'chain_height': len(blockchain.chain),
        'mempool_size': len(blockchain.mempool),
        'oracle_public_key': oracle.public_key_hex,
        'block_reward': blockchain.current_block_reward(),
        'difficulty': blockchain.last_block['difficulty'],
        'total_supply': sum(state.balances.values()),
        'markets_count': len(state.markets),
    })


@app.route('/api/chain')
def chain():
    return jsonify({'length': len(blockchain.chain), 'chain': blockchain.chain})


@app.route('/api/mempool')
def mempool():
    return jsonify({'size': len(blockchain.mempool), 'transactions': blockchain.mempool})


@app.route('/api/wallet/new', methods=['POST'])
def new_wallet():
    """Genera una nueva wallet (la clave privada se devuelve UNA VEZ)"""
    w = Wallet.generate()
    return jsonify({
        'private_key': w.private_key_hex,
        'public_key': w.public_key_hex,
        'address': w.address,
    })


@app.route('/api/wallet/<address>')
def wallet_info(address):
    if not address_is_valid(address):
        return err("Invalid address")
    state = blockchain.compute_state()
    # Posiciones del usuario
    positions = []
    for key, pos in state.positions.items():
        addr, mid = key.split("::")
        if addr == address and (pos['YES'] > 0 or pos['NO'] > 0):
            m = state.markets.get(mid)
            if m:
                positions.append({
                    'market_id': mid,
                    'question': m['question'],
                    'status': m['status'],
                    'resolution': m['resolution'],
                    'yes_shares': pos['YES'],
                    'no_shares': pos['NO'],
                    'current_yes_price': AMM.price_yes(m['yes_reserve'], m['no_reserve']),
                })
    return jsonify({
        'address': address,
        'balance': state.get_balance(address),
        'nonce': state.get_nonce(address),
        'faucet_claimed': address in state.faucet_claimed,
        'positions': positions,
    })


@app.route('/api/tx/build', methods=['POST'])
def build_tx():
    """
    Construye una tx UNSIGNED para que el cliente la firme localmente.
    body: { type, sender_pubkey, sender_address, data }
    """
    body = request.json
    required = ['type', 'sender_pubkey', 'sender_address', 'data']
    for k in required:
        if k not in body:
            return err(f"Missing field: {k}")
    sender = body['sender_address']
    if not address_is_valid(sender):
        return err("Invalid sender address")
    state = blockchain.compute_state()
    # Calcula nonce considerando mempool
    nonce = state.get_nonce(sender)
    for mtx in blockchain.mempool:
        if mtx.get('sender_address') == sender:
            nonce += 1
    tx = Transaction.build(body['type'], body['sender_pubkey'], sender, body['data'], nonce)
    return jsonify({
        'unsigned_tx': tx,
        'message_to_sign': Transaction.message_to_sign(tx).decode(),
    })


@app.route('/api/tx/submit', methods=['POST'])
def submit_tx():
    """
    body: la tx COMPLETA con signature.
    """
    tx = request.json
    if 'signature' not in tx:
        return err("Missing signature")
    error = blockchain.add_to_mempool(tx)
    if error:
        return err(error)
    return jsonify({'status': 'accepted', 'tx_hash': Transaction.hash(tx), 'mempool_size': len(blockchain.mempool)})


@app.route('/api/markets')
def markets():
    state = blockchain.compute_state()
    out = []
    for mid, m in state.markets.items():
        out.append({
            **m,
            'yes_price': AMM.price_yes(m['yes_reserve'], m['no_reserve']),
            'no_price': AMM.price_no(m['yes_reserve'], m['no_reserve']),
        })
    out.sort(key=lambda x: x['created_at'], reverse=True)
    return jsonify({'markets': out})


@app.route('/api/markets/<market_id>')
def market_detail(market_id):
    state = blockchain.compute_state()
    m = state.markets.get(market_id)
    if not m:
        return err("Market not found", 404)
    return jsonify({
        **m,
        'yes_price': AMM.price_yes(m['yes_reserve'], m['no_reserve']),
        'no_price': AMM.price_no(m['yes_reserve'], m['no_reserve']),
    })


@app.route('/api/markets/<market_id>/quote', methods=['POST'])
def market_quote(market_id):
    """
    body: { action: 'BUY'|'SELL', side: 'YES'|'NO', amount: number }
    Para BUY: amount es PEN_in. Para SELL: amount es shares_in.
    """
    body = request.json
    state = blockchain.compute_state()
    m = state.markets.get(market_id)
    if not m:
        return err("Market not found", 404)
    if m['status'] != 'OPEN':
        return err("Market not open")
    try:
        if body['action'] == 'BUY':
            q = AMM.buy_quote(m['yes_reserve'], m['no_reserve'], float(body['amount']), body['side'])
        else:
            q = AMM.sell_quote(m['yes_reserve'], m['no_reserve'], float(body['amount']), body['side'])
        return jsonify(q)
    except Exception as e:
        return err(str(e))


@app.route('/api/oracle/resolve', methods=['POST'])
def oracle_resolve():
    """
    El oráculo firma la resolución de un mercado.
    body: { market_id, outcome }
    Devuelve la resolución firmada (que luego el admin/creador envía como RESOLVE tx).
    En producción esto requeriría autenticación del oráculo. Para PoC es abierto.
    """
    body = request.json
    market_id = body.get('market_id')
    outcome = body.get('outcome')
    if not market_id or outcome not in ('YES', 'NO'):
        return err("Invalid request")
    state = blockchain.compute_state()
    if market_id not in state.markets:
        return err("Market not found", 404)
    if state.markets[market_id]['status'] != 'OPEN':
        return err("Market already resolved")
    res = oracle.sign_resolution(market_id, outcome, int(time.time()))
    return jsonify({'signed_resolution': res})


@app.route('/api/mine', methods=['POST'])
def mine():
    """Minar un bloque manualmente (para testing). Retorna el bloque minado."""
    body = request.json or {}
    miner = body.get('miner_address', MINER_WALLET.address)
    if not address_is_valid(miner):
        return err("Invalid miner address")
    if len(blockchain.mempool) == 0:
        return err("Mempool empty")
    block = blockchain.mine_block(miner)
    return jsonify({'block': block})


@app.route('/api/validate')
def validate():
    return jsonify({'valid': blockchain.validate_chain()})


# ==================== FRONTEND ====================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')


@app.route('/')
def root():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(FRONTEND_DIR, path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
