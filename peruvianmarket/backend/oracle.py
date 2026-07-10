"""
Oracle module
- Genera y mantiene un par de claves Ed25519 para el oráculo
- Firma resoluciones de mercados
- La cadena solo acepta una resolución si la firma del oráculo es válida
"""
import os
import json
from nacl.signing import SigningKey, VerifyKey
from nacl.exceptions import BadSignatureError
from nacl.encoding import HexEncoder

ORACLE_KEY_FILE = os.path.join(os.path.dirname(__file__), "oracle_key.json")


class Oracle:
    def __init__(self, signing_key: SigningKey):
        self.signing_key = signing_key
        self.verify_key = signing_key.verify_key

    @classmethod
    def load_or_create(cls) -> 'Oracle':
        if os.path.exists(ORACLE_KEY_FILE):
            with open(ORACLE_KEY_FILE) as f:
                data = json.load(f)
            sk = SigningKey(data['private_key'].encode(), encoder=HexEncoder)
        else:
            sk = SigningKey.generate()
            with open(ORACLE_KEY_FILE, 'w') as f:
                json.dump({
                    'private_key': sk.encode(encoder=HexEncoder).decode(),
                    'public_key': sk.verify_key.encode(encoder=HexEncoder).decode(),
                }, f, indent=2)
            os.chmod(ORACLE_KEY_FILE, 0o600)
        return cls(sk)

    @property
    def public_key_hex(self) -> str:
        return self.verify_key.encode(encoder=HexEncoder).decode()

    def sign_resolution(self, market_id: str, outcome: str, timestamp: int) -> dict:
        """
        Firma la resolución de un mercado.
        outcome: 'YES' o 'NO'
        Retorna un dict listo para incluir en una transacción de tipo RESOLVE.
        """
        if outcome not in ('YES', 'NO'):
            raise ValueError("outcome must be 'YES' or 'NO'")
        payload = {
            'type': 'RESOLUTION',
            'market_id': market_id,
            'outcome': outcome,
            'timestamp': timestamp,
        }
        message = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        signed = self.signing_key.sign(message)
        return {
            'payload': payload,
            'signature': signed.signature.hex(),
            'oracle_public_key': self.public_key_hex,
        }


def verify_resolution(resolution: dict, expected_oracle_pubkey: str) -> bool:
    """Verifica que la resolución haya sido firmada por el oráculo esperado"""
    try:
        if resolution.get('oracle_public_key') != expected_oracle_pubkey:
            return False
        payload = resolution['payload']
        message = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        vk = VerifyKey(expected_oracle_pubkey.encode(), encoder=HexEncoder)
        vk.verify(message, bytes.fromhex(resolution['signature']))
        return True
    except (BadSignatureError, KeyError, Exception):
        return False


if __name__ == "__main__":
    o = Oracle.load_or_create()
    print(f"Oracle public key: {o.public_key_hex}")
    res = o.sign_resolution("market_abc", "YES", 1234567890)
    print(json.dumps(res, indent=2))
    print(f"Verifica: {verify_resolution(res, o.public_key_hex)}")
    # Tampered
    res2 = dict(res)
    res2['payload'] = dict(res['payload'])
    res2['payload']['outcome'] = 'NO'
    print(f"Tampered verifica: {verify_resolution(res2, o.public_key_hex)}")
