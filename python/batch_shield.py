import os
import sys
import hashlib
from PIL import Image

TILE_SIZE = 32
MAGIC_MARKER = (42, 137, 219)
VALID_EXTS = ('.png', '.jpg', '.jpeg', '.webp')

# --- PRNG ---
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
            tiles.append(transform_tile(img.crop(box), modes[idx]))
            idx += 1

    out_img = Image.new('RGB', (crop_w, crop_h))
    for new_idx, orig_idx in enumerate(perm):
        c = new_idx % cols
        r = new_idx // cols
        out_img.paste(tiles[orig_idx], (c * TILE_SIZE, r * TILE_SIZE))

    out_img.save(output_path, quality=95)

def process_noise(input_path, output_path, key_phrase):
    rng = WebRNG(get_seed(key_phrase))
    with Image.open(input_path) as raw:
        img = raw.convert('RGB')
    clean_img = Image.new('RGB', img.size)
    clean_img.paste(img)
    pixels = clean_img.load()
    w, h = clean_img.size

    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            r ^= rng.randint(0, 255)
            g ^= rng.randint(0, 255)
            b ^= rng.randint(0, 255)
            pixels[x, y] = (r, g, b)

    pixels[0, 0] = MAGIC_MARKER
    clean_img.save(output_path, format='PNG')

def get_files_sorted(input_dir, sort_mode):
    entries = []
    for f in os.listdir(input_dir):
        p = os.path.join(input_dir, f)
        if os.path.isfile(p) and f.lower().endswith(VALID_EXTS):
            stat = os.stat(p)
            # Берем mtime (время изменения/сохранения инпейнта)
            entries.append((p, f, stat.st_mtime))

    if sort_mode == 'date':
        # Сортировка от старых к новым по времени сохранения
        entries.sort(key=lambda x: x[2])
    elif sort_mode == 'date_desc':
        # Сортировка от новых к старым
        entries.sort(key=lambda x: x[2], reverse=True)
    else:
        # По алфавиту
        entries.sort(key=lambda x: x[1].lower())

    return entries

def main():
    if len(sys.argv) < 4:
        print("[ERR] Недостаточно параметров.")
        sys.exit(1)

    enc_mode = sys.argv[1].lower()   # 'tiles' или 'noise'
    sort_mode = sys.argv[2].lower()  # 'date', 'name', 'date_desc'
    secret_key = sys.argv[3]

    base_dir = os.path.dirname(os.path.abspath(__file__))
    in_dir = os.path.join(base_dir, 'input')
    out_dir = os.path.join(base_dir, 'output')

    os.makedirs(in_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    files = get_files_sorted(in_dir, sort_mode)
    total = len(files)

    if total == 0:
        print(f"[!] Папка '{in_dir}' пуста! Положите туда картинки для обработки.")
        return

    print(f"Найдено картинок: {total}")
    print(f"Сортировка: {sort_mode} | Режим: {enc_mode}")
    print("-" * 50)

    for i, (src_path, filename, orig_mtime) in enumerate(files, 1):
        name_no_ext = os.path.splitext(filename)[0]
        
        # Добавляем префикс 001_, 002_, чтобы порядок в папке был железным
        pad = max(3, len(str(total)))
        prefix = str(i).zfill(pad)

        ext = '.png' if enc_mode == 'noise' else '.png'
        out_filename = f"{prefix}_{name_no_ext}_shielded{ext}"
        dst_path = os.path.join(out_dir, out_filename)

        try:
            if enc_mode == 'noise':
                process_noise(src_path, dst_path, secret_key)
            else:
                process_tiles(src_path, dst_path, secret_key)

            # Сохраняем оригинальную дату изменения файла
            os.utime(dst_path, (orig_mtime, orig_mtime))
            print(f"[{i}/{total}] OK -> {out_filename}")
        except Exception as e:
            print(f"[{i}/{total}] ERR {filename}: {e}")

    print("-" * 50)
    print(f"Успешно обработано: {total} файлов.")
    print(f"Результат сохранен в: {out_dir}")

if __name__ == '__main__':
    main()
