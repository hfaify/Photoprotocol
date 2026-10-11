// ==UserScript==
// @name         Photoprotocol Decryptor
// @namespace    https://github.com/hfaify/Photoprotocol
// @version      1.2.0
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
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TILE_SIZE = 32;

  // --- Хранилище настроек ---
  const storage = {
    get: (k, def) => localStorage.getItem('pp_' + k) || def,
    set: (k, v) => localStorage.setItem('pp_' + k, v)
  };

  // --- Интерфейс настроек ---
  function openSettings() {
    const currentKey = storage.get('secretKey', '');
    const currentMode = storage.get('decryptMode', 'tiles');

    const modalId = 'pp-modal-dialog';
    if (document.getElementById(modalId)) return;

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.65); z-index: 999999999; display: flex;
      align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif;
    `;

    modal.innerHTML = `
      <div style="background: #ffffff; color: #111; padding: 20px; border-radius: 10px; width: 280px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);">
        <h4 style="margin: 0 0 12px 0; font-size: 16px; display: flex; align-items: center; gap: 6px;">
          <span>🛡️</span> Photoprotocol
        </h4>

        <label style="font-size: 12px; font-weight: 600; display: block; margin-bottom: 4px;">Режим дешифровки:</label>
        <select id="pp-mode" style="width: 100%; padding: 7px; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px;">
          <option value="tiles" ${currentMode === 'tiles' ? 'selected' : ''}>Мозаика (Тайлинг 32px)</option>
          <option value="noise" ${currentMode === 'noise' ? 'selected' : ''}>Попиксельный шум (XOR)</option>
          <option value="off" ${currentMode === 'off' ? 'selected' : ''}>⏸️ Отключено</option>
        </select>

        <label style="font-size: 12px; font-weight: 600; display: block; margin-bottom: 4px;">Секретный ключ:</label>
        <input id="pp-key" type="password" value="${currentKey}" placeholder="Введите пароль" style="width: 94%; padding: 7px; margin-bottom: 16px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px;">

        <div style="display: flex; gap: 8px;">
          <button id="pp-save" style="flex: 1; padding: 8px; background: #0077ff; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">Сохранить</button>
          <button id="pp-close" style="padding: 8px 12px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 6px; cursor: pointer;">Закрыть</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('pp-save').onclick = () => {
      storage.set('secretKey', document.getElementById('pp-key').value.trim());
      storage.set('decryptMode', document.getElementById('pp-mode').value);
      modal.remove();
      location.reload();
    };

    document.getElementById('pp-close').onclick = () => modal.remove();
  }

  // Меню расширения
  try {
    if (typeof GM_registerMenuCommand !== 'undefined') {
      GM_registerMenuCommand("⚙️ Настройки Photoprotocol", openSettings);
    }
  } catch (e) {}

  // Горячая клавиша: Alt + P
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyP' || e.key === 'p' || e.key === 'з')) {
      openSettings();
    }
  });

  // Плавающая кнопка
  function injectFloatingButton() {
    if (document.getElementById('pp-badge-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'pp-badge-btn';
    btn.innerHTML = '🛡️';
    btn.title = 'Настройки Photoprotocol (Alt+P)';
    btn.style.cssText = `
      position: fixed; bottom: 18px; right: 18px; width: 34px; height: 34px;
      background: #0077ff; color: #fff; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; font-size: 16px; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3); z-index: 999999; opacity: 0.75;
      transition: opacity 0.2s, transform 0.2s; user-select: none;
    `;
    btn.onmouseenter = () => { btn.style.opacity = '1'; btn.style.transform = 'scale(1.1)'; };
    btn.onmouseleave = () => { btn.style.opacity = '0.75'; btn.style.transform = 'scale(1)'; };
    btn.onclick = openSettings;
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingButton);
  } else {
    injectFloatingButton();
  }

  const secretKey = storage.get('secretKey', '');
  const mode = storage.get('decryptMode', 'tiles');

  if (mode === 'off' || !secretKey) return;

  // --- PRNG ---
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

  // Расчет сида без блокировки основного потока
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKey)).then(keyBuf => {
    const shaBytes = new Uint8Array(keyBuf);
    let globalSeed = 0n;
    for (let i = 0; i < 8; i++) {
      globalSeed = (globalSeed << 8n) | BigInt(shaBytes[i]);
    }

    startEngine(globalSeed);
  });

  function startEngine(globalSeed) {
    const layoutCache = new Map();

    function getLayout(totalTiles) {
      let res = layoutCache.get(totalTiles);
      if (res) return res;

      const rng = new WebRNG(globalSeed);
      const perm = Array.from({ length: totalTiles }, (_, i) => i);
      for (let i = totalTiles - 1; i > 0; i--) {
        const j = rng.nextInt(i + 1);
        const tmp = perm[i];
        perm[i] = perm[j];
        perm[j] = tmp;
      }

      const modes = new Uint8Array(totalTiles);
      for (let i = 0; i < totalTiles; i++) modes[i] = rng.nextInt(8);

      const invPerm = new Int32Array(totalTiles);
      for (let i = 0; i < totalTiles; i++) invPerm[perm[i]] = i;

      res = { invPerm, modes };
      layoutCache.set(totalTiles, res);
      return res;
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

    function unscramble(img) {
      if (img.dataset.pp || img.naturalWidth < 64 || img.naturalHeight < 64) return;
      img.dataset.pp = "1";

      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = w;
      renderCanvas.height = h;
      const renderCtx = renderCanvas.getContext('2d');

      try {
        renderCtx.drawImage(img, 0, 0);

        if (mode === 'tiles') {
          const cols = Math.floor(w / TILE_SIZE);
          const rows = Math.floor(h / TILE_SIZE);
          const totalTiles = cols * rows;
          if (totalTiles < 16) return;

          const { invPerm, modes } = getLayout(totalTiles);

          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = cols * TILE_SIZE;
          srcCanvas.height = rows * TILE_SIZE;
          const srcCtx = srcCanvas.getContext('2d');
          srcCtx.drawImage(renderCanvas, 0, 0);
          renderCtx.clearRect(0, 0, w, h);

          for (let origIdx = 0; origIdx < totalTiles; origIdx++) {
            const scrIdx = invPerm[origIdx];
            const sx = (scrIdx % cols) * TILE_SIZE;
            const sy = Math.floor(scrIdx / cols) * TILE_SIZE;
            const dx = (origIdx % cols) * TILE_SIZE;
            const dy = Math.floor(origIdx / cols) * TILE_SIZE;
            drawReversedTile(renderCtx, srcCanvas, sx, sy, dx, dy, modes[origIdx]);
          }
        } else if (mode === 'noise') {
          const check = renderCtx.getImageData(0, 0, 1, 1).data;
          if (check.at(0) !== 42 || check.at(1) !== 137 || check.at(2) !== 219) return;

          const rng = new WebRNG(globalSeed);
          const imgData = renderCtx.getImageData(0, 0, w, h);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            d[i]     ^= rng.randint(0, 255);
            d[i + 1] ^= rng.randint(0, 255);
            d[i + 2] ^= rng.randint(0, 255);
          }
          renderCtx.putImageData(imgData, 0, 0);
        }

        img.src = renderCanvas.toDataURL('image/jpeg', 0.95);
      } catch (e) {
        // Ошибки CORS
      }
    }

    function handleImg(img) {
      if (img.complete && img.naturalWidth > 0) unscramble(img);
      else img.addEventListener('load', () => unscramble(img), { once: true });
    }

    document.querySelectorAll('img').forEach(handleImg);

    const observer = new MutationObserver(mutations => {
        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'IMG') handleImg(node);
            else {
                const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
                for (let k = 0; k < imgs.length; k++) handleImg(imgs[k]);
                 }
            }
        }
    });
      observer.observe(document.body, { childList: true, subtree: true });
  }
})();
