"""
Wallet module - estilo Bitcoin
- Genera pares de llaves SECP256K1 (ECDSA)
- Deriva direcciones via SHA256 + RIPEMD160 + Base58Check
- Firma transacciones
"""
import hashlib
import os
from ecdsa import SigningKey, VerifyingKey, SECP256k1, BadSignatureError

# Alfabeto Base58 estilo Bitcoin
BASE58_ALPHABET = b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def base58_encode(b: bytes) -> str:
    n = int.from_bytes(b, 'big')
    encoded = b''
    while n > 0:
        n, rem = divmod(n, 58)
        encoded = BASE58_ALPHABET[rem:rem+1] + encoded
    # Preserve leading zero bytes
    pad = 0
    for byte in b:
        if byte == 0:
            pad += 1
        else:
            break
    return (b'1' * pad + encoded).decode()


def base58_decode(s: str) -> bytes:
    n = 0
    for char in s.encode():
        n = n * 58 + BASE58_ALPHABET.index(char)
    full = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    pad = 0
    for char in s:
        if char == '1':
            pad += 1
        else:
            break
    return b'\x00' * pad + full


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def ripemd160(data: bytes) -> bytes:
    h = hashlib.new('ripemd160')
    h.update(data)
    return h.digest()


def hash160(data: bytes) -> bytes:
    """SHA256 luego RIPEMD160 - igual que Bitcoin"""
    return ripemd160(sha256(data))


def public_key_to_address(public_key_bytes: bytes, version: bytes = b'\x35') -> str:
    """
    Convierte una clave pública a una dirección estilo Bitcoin.
    version 0x35 produce direcciones que empiezan con 'P' (Peruvian).
    """
    h = hash160(public_key_bytes)
    payload = version + h
    checksum = sha256(sha256(payload))[:4]
    return base58_encode(payload + checksum)


def address_is_valid(address: str) -> bool:
    try:
        decoded = base58_decode(address)
        if len(decoded) != 25:
            return False
        payload, checksum = decoded[:-4], decoded[-4:]
        return sha256(sha256(payload))[:4] == checksum
    except Exception:
        return False


class Wallet:
    def __init__(self, signing_key: SigningKey = None):
        self.signing_key = signing_key or SigningKey.generate(curve=SECP256k1)
        self.verifying_key = self.signing_key.get_verifying_key()

    @classmethod
    def from_private_key_hex(cls, hex_str: str) -> 'Wallet':
        sk = SigningKey.from_string(bytes.fromhex(hex_str), curve=SECP256k1)
        return cls(sk)

    @classmethod
    def generate(cls) -> 'Wallet':
        return cls()

    @property
    def private_key_hex(self) -> str:
        return self.signing_key.to_string().hex()

    @property
    def public_key_hex(self) -> str:
        return self.verifying_key.to_string().hex()

    @property
    def public_key_bytes(self) -> bytes:
        return self.verifying_key.to_string()

    @property
    def address(self) -> str:
        return public_key_to_address(self.public_key_bytes)

    def sign(self, message: bytes) -> str:
        """Firma un mensaje y retorna firma en hex"""
        return self.signing_key.sign(message, hashfunc=hashlib.sha256).hex()


def verify_signature(public_key_hex: str, signature_hex: str, message: bytes) -> bool:
    try:
        vk = VerifyingKey.from_string(bytes.fromhex(public_key_hex), curve=SECP256k1)
        return vk.verify(bytes.fromhex(signature_hex), message, hashfunc=hashlib.sha256)
    except (BadSignatureError, Exception):
        return False


if __name__ == "__main__":
    # Test rápido
    w = Wallet.generate()
    print(f"Privada: {w.private_key_hex}")
    print(f"Publica: {w.public_key_hex}")
    print(f"Address: {w.address}")
    print(f"Address valida: {address_is_valid(w.address)}")
    msg = b"hola mundo"
    sig = w.sign(msg)
    print(f"Firma valida: {verify_signature(w.public_key_hex, sig, msg)}")
