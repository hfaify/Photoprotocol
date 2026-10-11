// ==UserScript==
// @name         Photoprotocol Decryptor
// @namespace    https://github.com/hfaify/Photoprotocol
// @version      1.0.0
// @updateURL    https://github.com/hfaify/Photoprotocol/blob/main/userscript/photoprotocol.user.js
// @downloadURL  https://github.com/hfaify/Photoprotocol/blob/main/userscript/photoprotocol.user.js
// @description  Клиентская расшифровка артов Photoprotocol прямо в ленте соцсетей
// @author       hfaify
// @match        *://*://*
// @match        *://vk.com/*
// @match        *://*.vk.com/*
// @match        *://vk.ru/*
// @match        *://*.vk.ru/*
// @match        *://*.web.telegram.org/*
// @match        *://web.telegram.org/*
// @match        *://*.vkuserphoto.ru/*
// @match        *://*://*
// @match        *://civitai.com*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @noframes
// ==/UserScript==

(async function () {
  'use strict';

  const TILE_SIZE = 32;

  // --- 1. Меню настроек ---
  function openSettingsDialog() {
    const currentKey = GM_getValue('secretKey', '');
    const currentMode = GM_getValue('decryptMode', 'tiles');

    const modalId = 'photoprotocol-modal';
    if (document.getElementById(modalId)) return;

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.6); z-index: 99999999; display: flex;
      align-items: center; justify-content: center; font-family: system-ui, sans-serif;
    `;

    modal.innerHTML = `
      <div style="background: #fff; color: #222; padding: 20px; border-radius: 10px; width: 280px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);">
        <h3 style="margin: 0 0 12px 0; font-size: 16px;">🛡️ Photoprotocol</h3>

        <label style="display:block; margin-bottom: 4px; font-size: 12px; font-weight: bold;">Режим работы:</label>
        <select id="pp-mode" style="width: 100%; padding: 6px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px;">
          <option value="tiles" ${currentMode === 'tiles' ? 'selected' : ''}>Мозаика (Тайлинг 32px)</option>
          <option value="noise" ${currentMode === 'noise' ? 'selected' : ''}>Попиксельный шум (XOR)</option>
          <option value="off" ${currentMode === 'off' ? 'selected' : ''}>⏸️ Отключено</option>
        </select>

        <label style="display:block; margin-bottom: 4px; font-size: 12px; font-weight: bold;">Секретный ключ:</label>
        <input id="pp-key" type="password" value="${currentKey}" placeholder="Введите пароль" style="width: 93%; padding: 6px; margin-bottom: 16px; border: 1px solid #ccc; border-radius: 6px;">

        <div style="display: flex; gap: 8px;">
          <button id="pp-save" style="flex: 1; padding: 8px; background: #0077ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Сохранить</button>
          <button id="pp-close" style="padding: 8px 12px; background: #eee; border: none; border-radius: 6px; cursor: pointer;">Отмена</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pp-save').onclick = () => {
      const newKey = document.getElementById('pp-key').value.trim();
      const newMode = document.getElementById('pp-mode').value;
      GM_setValue('secretKey', newKey);
      GM_setValue('decryptMode', newMode);
      modal.remove();
      location.reload();
    };

    document.getElementById('pp-close').onclick = () => modal.remove();
  }

  GM_registerMenuCommand("⚙️ Настройки Photoprotocol", openSettingsDialog);

  const secretKey = GM_getValue('secretKey', '');
  const mode = GM_getValue('decryptMode', 'tiles');

  if (mode === 'off' || !secretKey) {
    return;
  }

  // --- 2. Быстрый генератор PRNG ---
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

  // Предварительный расчет 64-битного сида один раз при старте
  const keyEnc = new TextEncoder().encode(secretKey);
  const keyBuf = await crypto.subtle.digest('SHA-256', keyEnc);
  const shaBytes = new Uint8Array(keyBuf);
  let globalSeed = 0n;
  for (let i = 0; i < 8; i++) {
    globalSeed = (globalSeed << 8n) | BigInt(shaBytes[i]);
  }

  // Кэш перестановок для повторяющихся размеров картинок
  const layoutCache = new Map();

  function getLayout(totalTiles) {
    if (layoutCache.has(totalTiles)) {
      return layoutCache.get(totalTiles);
    }

    const rng = new WebRNG(globalSeed);
    const perm = Array.from({ length: totalTiles }, (_, i) => i);
    for (let i = totalTiles - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = perm[i];
      perm[i] = perm[j];
      arrSwap(perm, i, j, tmp);
    }

    const modes = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i++) {
      modes[i] = rng.nextInt(8);
    }

    const invPerm = new Int32Array(totalTiles);
    for (let i = 0; i < totalTiles; i++) {
      invPerm[perm[i]] = i;
    }

    const res = { invPerm, modes };
    layoutCache.set(totalTiles, res);
    return res;
  }

  function arrSwap(arr, i, j, tmp) {
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  function drawReversedTile(ctx, srcCanvas, sx, sy, dx, dy, m) {
    ctx.save();
    ctx.translate(dx + TILE_SIZE / 2, dy + TILE_SIZE / 2);

    switch (m) {
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

  // --- 3. Быстрая сборка Мозаики ---
  function runUnscrambleTiles(ctx, canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const cols = Math.floor(w / TILE_SIZE);
    const rows = Math.floor(h / TILE_SIZE);
    const totalTiles = cols * rows;

    if (totalTiles < 16) return false;

    const { invPerm, modes } = getLayout(totalTiles);

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

  // --- 4. Быстрая обработка Шума ---
  function runUnscrambleNoise(ctx, canvas) {
    const checkPixel = ctx.getImageData(0, 0, 1, 1).data;
    const hasMarker = (checkPixel[0] === 42 && checkPixel[1] === 137 && checkPixel[2] === 219);
    if (!hasMarker) return false;

    const rng = new WebRNG(globalSeed);
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

  // --- 5. Синхронная обработка элемента ---
  function processImage(img) {
    if (img.dataset.photoprotocol || img.naturalWidth < 64 || img.naturalHeight < 64) return;
    img.dataset.photoprotocol = "processing";

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    try {
      ctx.drawImage(img, 0, 0);

      let success = false;
      if (mode === 'tiles') {
        success = runUnscrambleTiles(ctx, canvas);
      } else if (mode === 'noise') {
        success = runUnscrambleNoise(ctx, canvas);
      }

      if (success) {
        img.src = canvas.toDataURL('image/jpeg', 0.95);
        img.dataset.photoprotocol = "done";
      } else {
        img.dataset.photoprotocol = "skipped";
      }
    } catch (e) {
      img.dataset.photoprotocol = "error";
    }
  }

  // Проверка конкретного DOM-узла
  function checkNode(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') {
      if (node.complete) processImage(node);
      else node.onload = () => processImage(node);
    } else {
      const imgs = node.querySelectorAll ? node.querySelectorAll('img:not([data-photoprotocol])') : [];
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        if (img.complete) processImage(img);
        else img.onload = () => processImage(img);
      }
    }
  }

  // Первичный проход
  document.querySelectorAll('img:not([data-photoprotocol])').forEach(img => {
    if (img.complete) processImage(img);
    else img.onload = () => processImage(img);
  });

  // Точечный MutationObserver без задержек и без сканирования всей страницы
  const observer = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        checkNode(added[j]);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
