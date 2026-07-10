"""
Test end-to-end:
1. Crear 3 wallets (alice, bob, market-creator)
2. Cada uno reclama el faucet (FAUCET tx)
3. Minar bloques
4. Market-creator crea un mercado con liquidez
5. Alice compra YES, Bob compra NO
6. Verificar precios
7. Oráculo firma resolución YES
8. Tx RESOLVE
9. Alice reclama (CLAIM) y verifica que recibió 1 PEN por share
"""
import sys
sys.path.insert(0, '.')

from blockchain import Blockchain, Transaction, AMM
from oracle import Oracle
from wallet import Wallet


def sign_and_apply(blockchain, wallet, tx_type, data):
    """Helper: construir, firmar y submitear una tx"""
    state = blockchain.compute_state()
    nonce = state.get_nonce(wallet.address)
    # Considerar mempool
    for mtx in blockchain.mempool:
        if mtx.get('sender_address') == wallet.address:
            nonce += 1
    tx = Transaction.build(tx_type, wallet.public_key_hex, wallet.address, data, nonce)
    msg = Transaction.message_to_sign(tx)
    tx['signature'] = wallet.sign(msg)
    err = blockchain.add_to_mempool(tx)
    if err:
        raise Exception(f"Tx rechazada: {err}")
    return tx


def main():
    # Setup
    oracle = Oracle.load_or_create()
    bc = Blockchain(oracle_pubkey=oracle.public_key_hex)
    miner = Wallet.generate()
    alice = Wallet.generate()
    bob = Wallet.generate()
    creator = Wallet.generate()

    print(f"Alice: {alice.address}")
    print(f"Bob:   {bob.address}")
    print(f"Creator: {creator.address}")
    print(f"Miner: {miner.address}")
    print()

    # 1. Faucets
    print("== FAUCETS ==")
    sign_and_apply(bc, alice, 'FAUCET', {})
    sign_and_apply(bc, bob, 'FAUCET', {})
    sign_and_apply(bc, creator, 'FAUCET', {})
    bc.mine_block(miner.address)
    state = bc.compute_state()
    print(f"Alice balance: {state.get_balance(alice.address)}")
    print(f"Bob balance: {state.get_balance(bob.address)}")
    print(f"Creator balance: {state.get_balance(creator.address)}")
    print(f"Miner balance: {state.get_balance(miner.address)}")
    print()

    # Doble faucet debe fallar
    print("== DOUBLE FAUCET (debe fallar) ==")
    try:
        sign_and_apply(bc, alice, 'FAUCET', {})
        print("ERROR: doble faucet permitido!")
    except Exception as e:
        print(f"OK rechazado: {e}")
    print()

    # 2. Create market
    print("== CREATE MARKET ==")
    sign_and_apply(bc, creator, 'CREATE_MARKET', {
        'question': 'Pedro Castillo sera presidente en 2026?',
        'description': 'Resuelve YES si Pedro Castillo es presidente al 31/12/2026',
        'close_timestamp': 1893456000,
        'initial_yes_prob': 0.49,
        'liquidity': 80.0,
    })
    bc.mine_block(miner.address)
    state = bc.compute_state()
    market_id = list(state.markets.keys())[0]
    m = state.markets[market_id]
    print(f"Market ID: {market_id}")
    print(f"YES reserve: {m['yes_reserve']:.4f}, NO reserve: {m['no_reserve']:.4f}")
    print(f"YES price: {AMM.price_yes(m['yes_reserve'], m['no_reserve']):.4f}")
    print(f"NO price:  {AMM.price_no(m['yes_reserve'], m['no_reserve']):.4f}")
    print(f"Creator balance after liquidity: {state.get_balance(creator.address)}")
    print()

    # 3. Alice buys YES with 20 PEN
    print("== ALICE BUYS YES (20 PEN) ==")
    quote = AMM.buy_quote(m['yes_reserve'], m['no_reserve'], 20.0, 'YES')
    print(f"Quote: {quote}")
    sign_and_apply(bc, alice, 'BUY', {
        'market_id': market_id,
        'side': 'YES',
        'pen_in': 20.0,
        'min_shares': quote['shares_out'] * 0.99,
    })
    bc.mine_block(miner.address)
    state = bc.compute_state()
    m = state.markets[market_id]
    pos = state.get_position(alice.address, market_id)
    print(f"Alice YES shares: {pos['YES']:.4f}")
    print(f"YES price now: {AMM.price_yes(m['yes_reserve'], m['no_reserve']):.4f}")
    print()

    # 4. Bob buys NO with 30 PEN
    print("== BOB BUYS NO (30 PEN) ==")
    quote = AMM.buy_quote(m['yes_reserve'], m['no_reserve'], 30.0, 'NO')
    print(f"Quote: {quote}")
    sign_and_apply(bc, bob, 'BUY', {
        'market_id': market_id,
        'side': 'NO',
        'pen_in': 30.0,
        'min_shares': quote['shares_out'] * 0.99,
    })
    bc.mine_block(miner.address)
    state = bc.compute_state()
    m = state.markets[market_id]
    pos_bob = state.get_position(bob.address, market_id)
    print(f"Bob NO shares: {pos_bob['NO']:.4f}")
    print(f"YES price now: {AMM.price_yes(m['yes_reserve'], m['no_reserve']):.4f}")
    print()

    # 5. Alice sells half her YES
    print("== ALICE SELLS HALF YES ==")
    pos_alice = state.get_position(alice.address, market_id)
    half = pos_alice['YES'] / 2
    quote = AMM.sell_quote(m['yes_reserve'], m['no_reserve'], half, 'YES')
    print(f"Sell quote: {quote}")
    sign_and_apply(bc, alice, 'SELL', {
        'market_id': market_id,
        'side': 'YES',
        'shares_in': half,
        'min_pen': quote['pen_out'] * 0.99,
    })
    bc.mine_block(miner.address)
    state = bc.compute_state()
    print(f"Alice balance after sell: {state.get_balance(alice.address):.4f}")
    pos_alice = state.get_position(alice.address, market_id)
    print(f"Alice YES shares: {pos_alice['YES']:.4f}")
    print()

    # 6. Oracle signs resolution YES
    print("== ORACLE RESOLVES YES ==")
    import time as t
    resolution = oracle.sign_resolution(market_id, 'YES', int(t.time()))
    print(f"Resolution: outcome={resolution['payload']['outcome']}")

    # Tampered resolution debe fallar
    tampered = dict(resolution)
    tampered['payload'] = dict(resolution['payload'])
    tampered['payload']['outcome'] = 'NO'
    print("== INTENTAR APLICAR RESOLUCIÓN TAMPERED ==")
    try:
        sign_and_apply(bc, creator, 'RESOLVE', {'market_id': market_id, 'resolution': tampered})
        print("ERROR: tampered resolution aceptada!")
    except Exception as e:
        print(f"OK rechazado: {e}")
    print()

    # Aplicar resolución legítima
    sign_and_apply(bc, creator, 'RESOLVE', {'market_id': market_id, 'resolution': resolution})
    bc.mine_block(miner.address)
    state = bc.compute_state()
    m = state.markets[market_id]
    print(f"Market status: {m['status']}, resolution: {m['resolution']}")
    print()

    # 7. Alice claims
    print("== ALICE CLAIMS ==")
    pos_alice_before = state.get_position(alice.address, market_id)
    bal_before = state.get_balance(alice.address)
    print(f"Alice YES shares before claim: {pos_alice_before['YES']:.4f}")
    print(f"Alice balance before claim: {bal_before:.4f}")
    sign_and_apply(bc, alice, 'CLAIM', {'market_id': market_id})
    bc.mine_block(miner.address)
    state = bc.compute_state()
    print(f"Alice balance after claim: {state.get_balance(alice.address):.4f}")
    print(f"  -> ganancia esperada: ~{pos_alice_before['YES']:.4f} PEN")
    print()

    # 8. Bob trata de claim (perdió, no tiene YES shares)
    print("== BOB CLAIM (debe fallar - perdió) ==")
    try:
        sign_and_apply(bc, bob, 'CLAIM', {'market_id': market_id})
        print("ERROR: Bob pudo claim!")
    except Exception as e:
        print(f"OK rechazado: {e}")
    print()

    # 9. Validar cadena completa
    print(f"== CHAIN VALIDATION ==")
    print(f"Cadena válida: {bc.validate_chain()}")
    print(f"Altura: {len(bc.chain)}")
    print(f"Total supply: {sum(state.balances.values()):.4f} PEN")
    print()

    # 10. Anti-double-spend
    print("== INTENTAR DOBLE GASTO ==")
    state = bc.compute_state()
    bal_alice = state.get_balance(alice.address)
    print(f"Alice balance: {bal_alice}")
    try:
        sign_and_apply(bc, alice, 'TRANSFER', {'to': bob.address, 'amount': bal_alice + 100})
        print("ERROR: gasto sin saldo permitido!")
    except Exception as e:
        print(f"OK rechazado: {e}")


if __name__ == "__main__":
    main()
