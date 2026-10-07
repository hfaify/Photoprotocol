const TILE_SIZE = 32;
const MAGIC_MARKER = new Uint8Array([42, 137, 219]);

// 1. Криптография и генераторы
async function sha256Bytes(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(buf);
}

function getSeedInt(shaBytes) {
  let seed = 0n;
  for (let i = 0; i < 8; i++) {
    seed = (seed << 8n) | BigInt(shaBytes[i]);
  }
  return seed;
}

class WebRNG {
  constructor(seedBigInt) {
    this.state = Number(seedBigInt & 0xFFFFFFFFn);
  }
  nextInt(maxVal) {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const rnd = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(rnd * maxVal);
  }
  randint(min, max) {
    return this.nextInt(max - min + 1) + min;
  }
}

// 2. Логика для Мозаики (Тайлинга)
function getPermutation(n, rng) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function drawReversedTile(ctx, srcCanvas, sx, sy, dx, dy, mode) {
  ctx.save();
  ctx.translate(dx + TILE_SIZE / 2, dy + TILE_SIZE / 2);

  switch (mode) {
    case 0: break;
    case 1: ctx.rotate(Math.PI / 2); break;
    case 2: ctx.rotate(Math.PI); break;
    case 3: ctx.rotate(-Math.PI / 2); break;
    case 4: ctx.scale(-1, 1); break;
    case 5: ctx.scale(1, -1); break;
    case 6: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, 0, 0); break;
  }

  ctx.drawImage(srcCanvas, sx, sy, TILE_SIZE, TILE_SIZE, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
  ctx.restore();
}

function runUnscrambleTiles(ctx, canvas, seed) {
  const w = canvas.width;
  const h = canvas.height;
  const cols = Math.floor(w / TILE_SIZE);
  const rows = Math.floor(h / TILE_SIZE);
  const totalTiles = cols * rows;

  if (totalTiles < 16) return false;

  const rng = new WebRNG(seed);
  const perm = getPermutation(totalTiles, rng);
  const modes = [];
  for (let i = 0; i < totalTiles; i++) modes.push(rng.nextInt(8));

  const invPerm = new Int32Array(totalTiles);
  for (let i = 0; i < totalTiles; i++) invPerm[perm[i]] = i;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = canvas.width;
  srcCanvas.height = canvas.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(canvas, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let origIdx = 0; origIdx < totalTiles; origIdx++) {
    const scrIdx = invPerm[origIdx];
    const sx = (scrIdx % cols) * TILE_SIZE;
    const sy = Math.floor(scrIdx / cols) * TILE_SIZE;
    const dx = (origIdx % cols) * TILE_SIZE;
    const dy = Math.floor(origIdx / cols) * TILE_SIZE;
    drawReversedTile(ctx, srcCanvas, sx, sy, dx, dy, modes[origIdx]);
  }
  return true;
}

// 3. Логика для Попиксельного шума (XOR)
function runUnscrambleNoise(ctx, canvas, seed) {
  const checkPixel = ctx.getImageData(0, 0, 1, 1).data;
  const hasMarker = checkPixel[0] === MAGIC_MARKER[0] &&
                    checkPixel[1] === MAGIC_MARKER[1] &&
                    checkPixel[2] === MAGIC_MARKER[2];

  // В ручном режиме применяем даже без маркера, в авто — только по маркеру
  const rng = new WebRNG(seed);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     ^= rng.randint(0, 255);
    data[i + 1] ^= rng.randint(0, 255);
    data[i + 2] ^= rng.randint(0, 255);
  }
  ctx.putImageData(imgData, 0, 0);
  return true;
}

// Главный пайплайн дешифровки
async function processImage(img, secretKey, mode) {
  if (img.dataset.decrypted === "true" || img.naturalWidth < 64 || img.naturalHeight < 64) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  try {
    ctx.drawImage(img, 0, 0);

    const sha = await sha256Bytes(secretKey);
    const seed = getSeedInt(sha);

    let success = false;
    if (mode === 'tiles') {
      success = runUnscrambleTiles(ctx, canvas, seed);
    } else if (mode === 'noise') {
      success = runUnscrambleNoise(ctx, canvas, seed);
    } else if (mode === 'auto') {
      // Проверяем первый пиксель на маркер шума
      const checkPixel = ctx.getImageData(0, 0, 1, 1).data;
      const isNoise = checkPixel[0] === MAGIC_MARKER[0] &&
                      checkPixel[1] === MAGIC_MARKER[1] &&
                      checkPixel[2] === MAGIC_MARKER[2];

      if (isNoise) {
        success = runUnscrambleNoise(ctx, canvas, seed);
      } else {
        success = runUnscrambleTiles(ctx, canvas, seed);
      }
    }

    if (success) {
      img.src = canvas.toDataURL('image/jpeg', 0.95);
      img.dataset.decrypted = "true";
    }
  } catch (e) {
    // CORS ограничения
  }
}

// Запуск расширения
chrome.storage.local.get(['secretKey', 'decryptMode'], (res) => {
  const mode = res.decryptMode || 'tiles';

  // Если выбран режим "Отключено" или ключ не задан — полностью останавливаем работу
  if (mode === 'off' || !res.secretKey) {
    return;
  }

  const run = () => {
    document.querySelectorAll('img:not([data-decrypted="true"])').forEach(img => {
      if (img.complete) {
        processImage(img, res.secretKey, mode);
      } else {
        img.onload = () => processImage(img, res.secretKey, mode);
      }
    });
  };

  run();
  // Наблюдатель за динамической подгрузкой ленты
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
});