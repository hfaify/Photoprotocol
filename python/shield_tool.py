import os
import sys
import hashlib
from PIL import Image

TILE_SIZE = 32
MAGIC_MARKER = (42, 137, 219)

# 1. Генератор псевдослучайных чисел (WebRNG, идентичен JS в расширении)
class WebRNG:
    def __init__(self, seed_int):
        self.state = seed_int & 0xFFFFFFFF

    def next_int(self, max_val):
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = (self.state ^ (self.state >> 15)) * (1 | self.state) & 0xFFFFFFFF
        t = ((t + ((t ^ (t >> 7)) * (61 | t) & 0xFFFFFFFF)) ^ t) & 0xFFFFFFFF
        rnd = ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
        return int(rnd * max_val)

    def randint(self, min_val, max_val):
        return self.next_int(max_val - min_val + 1) + min_val

def get_seed(key_phrase):
    seed_hash = hashlib.sha256(key_phrase.encode('utf-8')).digest()
    return int.from_bytes(seed_hash[:8], 'big')

# 2. Логика режима МОЗАИКИ (Tiles)
TRANSFORMS_PY = [
    None,
    Image.Transpose.ROTATE_90,
    Image.Transpose.ROTATE_180,
    Image.Transpose.ROTATE_270,
    Image.Transpose.FLIP_LEFT_RIGHT,
    Image.Transpose.FLIP_TOP_BOTTOM,
    Image.Transpose.TRANSPOSE,
    Image.Transpose.TRANSVERSE
]

def transform_tile(tile, mode):
    op = TRANSFORMS_PY[mode]
    return tile.transpose(op) if op is not None else tile

def process_tiles(input_path, output_path, key_phrase):
    rng = WebRNG(get_seed(key_phrase))

    with Image.open(input_path) as raw:
        img = raw.convert('RGB')
    w, h = img.size

    cols = w // TILE_SIZE
    rows = h // TILE_SIZE
    crop_w = cols * TILE_SIZE
    crop_h = rows * TILE_SIZE
    img = img.crop((0, 0, crop_w, crop_h))

    total_tiles = cols * rows
    
    # Тасование Fisher-Yates
    perm = list(range(total_tiles))
    for i in range(total_tiles - 1, 0, -1):
        j = rng.next_int(i + 1)
        perm[i], perm[j] = perm[j], perm[i]

    modes = [rng.next_int(8) for _ in range(total_tiles)]

    tiles = []
    idx = 0
    for r in range(rows):
        for c in range(cols):
            box = (c * TILE_SIZE, r * TILE_SIZE, (c + 1) * TILE_SIZE, (r + 1) * TILE_SIZE)
            tile = img.crop(box)
            tiles.append(transform_tile(tile, modes[idx]))
            idx += 1

    out_img = Image.new('RGB', (crop_w, crop_h))
    for new_idx, orig_idx in enumerate(perm):
        c = new_idx % cols
        r = new_idx // cols
        out_img.paste(tiles[orig_idx], (c * TILE_SIZE, r * TILE_SIZE))

    out_img.save(output_path, quality=95)

# 3. Логика режима ШУМА (XOR Noise)
def process_noise(input_path, output_path, key_phrase):
    rng = WebRNG(get_seed(key_phrase))

    with Image.open(input_path) as raw:
        img = raw.convert('RGB')
    
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            r ^= rng.randint(0, 255)
            g ^= rng.randint(0, 255)
            b ^= rng.randint(0, 255)
            pixels[x, y] = (r, g, b)

    # Вшиваем сигнатуру в пиксель (0, 0) для автодетекта в расширении
    pixels[0, 0] = MAGIC_MARKER
    img.save(output_path, 'PNG')

# Точка входа
if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("[ERR] Использование: python shield_tool.py <mode: tiles|noise> <key> <files...>")
        sys.exit(1)

    mode = sys.argv[1].lower()
    secret_key = sys.argv[2]
    image_paths = sys.argv[3:]

    for file_path in image_paths:
        if not os.path.isfile(file_path):
            continue
        
        base, ext = os.path.splitext(file_path)
        
        if mode == 'noise':
            out_file = f"{base}_noise.png"
            try:
                process_noise(file_path, out_file, secret_key)
                print(f"[OK] Шум (XOR) сохранен: {os.path.basename(out_file)}")
            except Exception as e:
                print(f"[ERR] Ошибка {file_path}: {e}")
        else:
            out_file = f"{base}_shielded.png"
            try:
                process_tiles(file_path, out_file, secret_key)
                print(f"[OK] Мозаика сохранена: {os.path.basename(out_file)}")
            except Exception as e:
                print(f"[ERR] Ошибка {file_path}: {e}")
