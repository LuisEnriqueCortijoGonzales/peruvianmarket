"""
LSB Steganography — Bit Menos Significativo
Oculta/extrae mensajes en imágenes PNG usando el LSB de cada canal RGB.
"""

from PIL import Image
import sys

DELIMITER = "###FIN###"


def texto_a_bits(texto: str) -> str:
    """Convierte string UTF-8 a cadena de bits."""
    return "".join(f"{byte:08b}" for byte in texto.encode("utf-8"))


def bits_a_texto(bits: str) -> str:
    """Convierte cadena de bits a string UTF-8."""
    chars = []
    for i in range(0, len(bits), 8):
        byte = bits[i:i+8]
        if len(byte) < 8:
            break
        chars.append(chr(int(byte, 2)))
    return "".join(chars)


def capacidad_maxima(img: Image.Image) -> int:
    """Bytes máximos ocultables en la imagen (1 bit por canal RGB)."""
    w, h = img.size
    total_bits = w * h * 3   # 3 canales: R, G, B
    return total_bits // 8


def ocultar(ruta_entrada: str, mensaje: str, ruta_salida: str) -> None:
    """
    Oculta un mensaje en una imagen usando LSB.
    Guarda el resultado como PNG (sin pérdida).
    """
    img = Image.open(ruta_entrada).convert("RGB")
    pixeles = list(img.getdata())

    payload = mensaje + DELIMITER
    bits = texto_a_bits(payload)

    max_bytes = capacidad_maxima(img)
    if len(bits) > max_bytes * 8:
        raise ValueError(
            f"Mensaje demasiado largo. "
            f"Máximo: {max_bytes} bytes, necesario: {len(bits)//8} bytes."
        )

    bit_idx = 0
    nuevos_pixeles = []

    for r, g, b in pixeles:
        canales = [r, g, b]
        nuevos = []
        for canal in canales:
            if bit_idx < len(bits):
                # Reemplaza el LSB del canal con el bit del mensaje
                canal = (canal & 0xFE) | int(bits[bit_idx])
                bit_idx += 1
            nuevos.append(canal)
        nuevos_pixeles.append(tuple(nuevos))

    img_salida = Image.new("RGB", img.size)
    img_salida.putdata(nuevos_pixeles)
    img_salida.save(ruta_salida, format="PNG")

    print(f"[OK] Mensaje oculto en '{ruta_salida}'")
    print(f"     Bits usados : {bit_idx} / {max_bytes*8}")
    print(f"     Bytes usados: {bit_idx//8} / {max_bytes}")


def extraer(ruta_imagen: str) -> str:
    """
    Extrae el mensaje oculto de una imagen con LSB.
    """
    img = Image.open(ruta_imagen).convert("RGB")
    pixeles = list(img.getdata())

    bits = []
    for r, g, b in pixeles:
        bits.append(str(r & 1))
        bits.append(str(g & 1))
        bits.append(str(b & 1))

    # Reconstruir texto de a 8 bits, buscando el delimitador
    mensaje = ""
    for i in range(0, len(bits), 8):
        byte = "".join(bits[i:i+8])
        if len(byte) < 8:
            break
        char = chr(int(byte, 2))
        mensaje += char
        if mensaje.endswith(DELIMITER):
            return mensaje[: -len(DELIMITER)]

    raise ValueError("No se encontró ningún mensaje oculto (delimitador ausente).")


def visualizar_lsb(ruta_imagen: str, ruta_salida: str) -> None:
    """
    Genera una imagen amplificando el LSB de cada canal × 255
    para visualizar dónde hay datos ocultos.
    """
    img = Image.open(ruta_imagen).convert("RGB")
    pixeles = list(img.getdata())

    lsb_pixeles = [
        ((r & 1) * 255, (g & 1) * 255, (b & 1) * 255)
        for r, g, b in pixeles
    ]

    img_lsb = Image.new("RGB", img.size)
    img_lsb.putdata(lsb_pixeles)
    img_lsb.save(ruta_salida, format="PNG")
    print(f"[OK] Visualización LSB guardada en '{ruta_salida}'")


# ── Demo ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import os

    IMG_ORIGINAL = "imagen_original.png"
    IMG_STEGO    = "imagen_stego.png"
    IMG_LSB_VIZ  = "imagen_lsb_viz.png"

    # Si no existe imagen de prueba, crear una de colores aleatorios
    if not os.path.exists(IMG_ORIGINAL):
        import random
        print("[INFO] No se encontró imagen de prueba. Creando una de 200×200 px...")
        test = Image.new("RGB", (200, 200))
        test.putdata([(random.randint(0,255), random.randint(0,255),
                       random.randint(0,255)) for _ in range(200*200)])
        test.save(IMG_ORIGINAL)
        print(f"[INFO] Imagen creada: {IMG_ORIGINAL}")

    img_info = Image.open(IMG_ORIGINAL)
    cap = capacidad_maxima(img_info)
    print(f"\n{'─'*50}")
    print(f"  Imagen    : {IMG_ORIGINAL}  ({img_info.size[0]}×{img_info.size[1]} px)")
    print(f"  Capacidad : {cap} bytes ({cap*8} bits)")
    print(f"{'─'*50}\n")

    # ── OCULTAR ──────────────────────────────────────────────────────────────
    MENSAJE = (
        "Cyndaquil es el mejor starter de Johto. "
        "Este mensaje está oculto en el bit menos significativo de cada pixel."
    )

    print(f"[OCULTAR] Mensaje: '{MENSAJE}'")
    ocultar(IMG_ORIGINAL, MENSAJE, IMG_STEGO)

    # ── EXTRAER ───────────────────────────────────────────────────────────────
    print()
    recuperado = extraer(IMG_STEGO)
    print(f"[EXTRAER] Mensaje recuperado: '{recuperado}'")

    assert recuperado == MENSAJE, "¡Error: el mensaje no coincide!"
    print("\n[OK] Verificación correcta — el mensaje fue recuperado sin pérdida.")

    # ── VISUALIZAR LSB ────────────────────────────────────────────────────────
    print()
    visualizar_lsb(IMG_STEGO, IMG_LSB_VIZ)
    print(f"\n[INFO] Archivos generados:")
    print(f"  {IMG_ORIGINAL}  — imagen original sin modificar")
    print(f"  {IMG_STEGO}     — imagen con mensaje oculto")
    print(f"  {IMG_LSB_VIZ}   — mapa de bits LSB (blanco = 1, negro = 0)")