import os
import sys
import hashlib
from PIL import Image
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QLabel, QFileDialog, QInputDialog,
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QComboBox
)
from PyQt6.QtGui import QImage, QPixmap, QKeyEvent, QWheelEvent
from PyQt6.QtCore import Qt

TILE_SIZE = 32
MAGIC_MARKER = (42, 137, 219)
VALID_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.bmp')

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
    Image.Transpose.ROTATE_270,
    Image.Transpose.ROTATE_180,
    Image.Transpose.ROTATE_90,
    Image.Transpose.FLIP_LEFT_RIGHT,
    Image.Transpose.FLIP_TOP_BOTTOM,
    Image.Transpose.TRANSPOSE,
    Image.Transpose.TRANSVERSE
]

def unscramble_tiles(img, key):
    rng = WebRNG(get_seed(key))
    w, h = img.size
    cols = w // TILE_SIZE
    rows = h // TILE_SIZE
    total_tiles = cols * rows
    if total_tiles < 16:
        return img

    perm = list(range(total_tiles))
    for i in range(total_tiles - 1, 0, -1):
        j = rng.next_int(i + 1)
        perm[i], perm[j] = perm[j], perm[i]

    modes = [rng.next_int(8) for _ in range(total_tiles)]

    inv_perm = [0] * total_tiles
    for i in range(total_tiles):
        inv_perm[perm[i]] = i

    tiles = []
    for r in range(rows):
        for c in range(cols):
            box = (c * TILE_SIZE, r * TILE_SIZE, (c + 1) * TILE_SIZE, (r + 1) * TILE_SIZE)
            tiles.append(img.crop(box))

    restored = Image.new('RGB', (cols * TILE_SIZE, rows * TILE_SIZE))
    for orig_idx in range(total_tiles):
        scr_idx = inv_perm[orig_idx]
        tile = tiles[scr_idx]
        op = TRANSFORMS_PY[modes[orig_idx]]
        if op is not None:
            tile = tile.transpose(op)

        c = orig_idx % cols
        r = orig_idx // cols
        restored.paste(tile, (c * TILE_SIZE, r * TILE_SIZE))

    return restored

def unscramble_noise(img, key):
    rng = WebRNG(get_seed(key))
    w, h = img.size
    clean_img = Image.new('RGB', (w, h))
    clean_pixels = clean_img.load()
    pixels = img.load()

    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y][:3]
            r ^= rng.randint(0, 255)
            g ^= rng.randint(0, 255)
            b ^= rng.randint(0, 255)
            clean_pixels[x, y] = (r, g, b)

    return clean_img

def pil_to_pixmap(pil_img):
    data = pil_img.tobytes("raw", "RGB")
    qimg = QImage(data, pil_img.width, pil_img.height, pil_img.width * 3, QImage.Format.Format_RGB888)
    return QPixmap.fromImage(qimg)

class ViewerApp(QMainWindow):
    def __init__(self, initial_path=None):
        super().__init__()
        self.setWindowTitle("Photoprotocol Viewer")
        self.resize(1024, 700)
        self.setStyleSheet("background-color: #121212; color: #ffffff;")

        self.key, self.mode = self.load_settings()
        self.file_list = []
        self.current_index = -1
        self.current_pil_img = None

        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        self.layout = QVBoxLayout(central_widget)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)

        # Верхняя панель управления
        self.top_bar = QWidget()
        self.top_bar.setFixedHeight(40)
        self.top_bar.setStyleSheet("background-color: #1f1f1f; padding: 4px;")
        top_layout = QHBoxLayout(self.top_bar)
        top_layout.setContentsMargins(10, 0, 10, 0)

        self.btn_open = QPushButton("📁 Открыть")
        self.btn_open.setStyleSheet("background-color: #333; padding: 6px 12px; border-radius: 4px;")
        self.btn_open.clicked.connect(self.open_file_dialog)
        top_layout.addWidget(self.btn_open)

        self.btn_key = QPushButton("🔑 Ключ")
        self.btn_key.setStyleSheet("background-color: #333; padding: 6px 12px; border-radius: 4px;")
        self.btn_key.clicked.connect(self.change_key_dialog)
        top_layout.addWidget(self.btn_key)

        # Выбор режима
        self.combo_mode = QComboBox()
        self.combo_mode.addItems(["Шум (XOR)", "Мозаика", "Авто"])
        self.combo_mode.setStyleSheet("background-color: #333; color: #fff; padding: 4px; border-radius: 4px;")
        mode_indices = {"noise": 0, "tiles": 1, "auto": 2}
        self.combo_mode.setCurrentIndex(mode_indices.get(self.mode, 0))
        self.combo_mode.currentIndexChanged.connect(self.on_mode_changed)
        top_layout.addWidget(self.combo_mode)

        self.lbl_info = QLabel("Перетащите изображение в окно или нажмите Открыть (F11 - экран, M - смена режима)")
        self.lbl_info.setStyleSheet("color: #888; font-size: 13px; margin-left: 10px;")
        top_layout.addWidget(self.lbl_info)
        top_layout.addStretch()

        self.layout.addWidget(self.top_bar)

        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet("background-color: #121212;")
        self.layout.addWidget(self.image_label)

        self.setAcceptDrops(True)

        if initial_path and os.path.isfile(initial_path):
            self.load_folder_and_file(initial_path)

    def load_settings(self):
        cfg = os.path.join(os.path.expanduser("~"), ".photoprotocol_settings")
        key = "my_secret_key"
        mode = "noise"
        if os.path.exists(cfg):
            try:
                with open(cfg, "r", encoding="utf-8") as f:
                    lines = [line.strip() for line in f.readlines()]
                    if len(lines) > 0 and lines[0]:
                        key = lines[0]
                    if len(lines) > 1 and lines[1]:
                        mode = lines[1]
            except Exception:
                pass
        return key, mode

    def save_settings(self):
        cfg = os.path.join(os.path.expanduser("~"), ".photoprotocol_settings")
        try:
            with open(cfg, "w", encoding="utf-8") as f:
                f.write(f"{self.key}\n{self.mode}\n")
        except Exception:
            pass

    def on_mode_changed(self, index):
        modes = ["noise", "tiles", "auto"]
        self.mode = modes[index]
        self.save_settings()
        if self.current_index >= 0:
            self.load_image(self.file_list[self.current_index])

    def change_key_dialog(self):
        key, ok = QInputDialog.getText(self, "Ключ Photoprotocol", "Введите секретный ключ дешифровки:", text=self.key)
        if ok and key:
            self.key = key.strip()
            self.save_settings()
            if self.current_index >= 0:
                self.load_image(self.file_list[self.current_index])

    def open_file_dialog(self):
        path, _ = QFileDialog.getOpenFileName(self, "Выберите картинку", "", "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if path:
            self.load_folder_and_file(path)

    def load_folder_and_file(self, file_path):
        folder = os.path.dirname(os.path.abspath(file_path))
        self.file_list = [
            os.path.join(folder, f) for f in os.listdir(folder)
            if f.lower().endswith(VALID_EXTS) and os.path.isfile(os.path.join(folder, f))
        ]
        self.file_list.sort(key=lambda x: x.lower())
        try:
            self.current_index = self.file_list.index(file_path)
        except ValueError:
            self.current_index = 0

        self.load_image(self.file_list[self.current_index])

    def load_image(self, path):
        try:
            with Image.open(path) as raw:
                img = raw.convert("RGB")

            p0 = img.load()[0, 0][:3]
            is_noise_marked = (p0 == MAGIC_MARKER)

            # Выбор метода дешифровки
            if self.mode == "noise":
                self.current_pil_img = unscramble_noise(img, self.key)
                tag = "[Шум]"
            elif self.mode == "tiles":
                self.current_pil_img = unscramble_tiles(img, self.key)
                tag = "[Мозаика]"
            else:  # auto
                if is_noise_marked:
                    self.current_pil_img = unscramble_noise(img, self.key)
                    tag = "[Авто: Шум]"
                else:
                    self.current_pil_img = unscramble_tiles(img, self.key)
                    tag = "[Авто: Мозаика]"

            self.lbl_info.setText(f"{tag} {os.path.basename(path)} ({self.current_index + 1}/{len(self.file_list)})")
            self.render_image()
        except Exception as e:
            self.lbl_info.setText(f"Ошибка загрузки: {e}")

    def render_image(self):
        if not self.current_pil_img:
            return

        w = self.image_label.width()
        h = self.image_label.height()
        if w < 10 or h < 10:
            return

        pixmap = pil_to_pixmap(self.current_pil_img)
        scaled_pixmap = pixmap.scaled(
            w, h,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.image_label.setPixmap(scaled_pixmap)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.render_image()

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() == Qt.Key.Key_Right:
            self.navigate(1)
        elif event.key() == Qt.Key.Key_Left:
            self.navigate(-1)
        elif event.key() == Qt.Key.Key_F11:
            if self.isFullScreen():
                self.showNormal()
                self.top_bar.show()
            else:
                self.showFullScreen()
                self.top_bar.hide()
        elif event.key() == Qt.Key.Key_Escape and self.isFullScreen():
            self.showNormal()
            self.top_bar.show()
        elif event.key() == Qt.Key.Key_K:
            self.change_key_dialog()
        elif event.key() == Qt.Key.Key_M:
            next_idx = (self.combo_mode.currentIndex() + 1) % 3
            self.combo_mode.setCurrentIndex(next_idx)
        else:
            super().keyPressEvent(event)

    def wheelEvent(self, event: QWheelEvent):
        delta = event.angleDelta().y()
        if delta < 0:
            self.navigate(1)
        elif delta > 0:
            self.navigate(-1)

    def navigate(self, step):
        if not self.file_list:
            return
        self.current_index = (self.current_index + step) % len(self.file_list)
        self.load_image(self.file_list[self.current_index])

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event):
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            if os.path.isfile(path):
                self.load_folder_and_file(path)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    init_file = sys.argv[1] if len(sys.argv) > 1 else None
    viewer = ViewerApp(init_file)
    viewer.show()
    sys.exit(app.exec())