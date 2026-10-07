document.addEventListener('DOMContentLoaded', () => {
  const keyInput = document.getElementById('keyInput');
  const modeSelect = document.getElementById('modeSelect');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  // Загружаем сохраненные настройки
  chrome.storage.local.get(['secretKey', 'decryptMode'], (res) => {
    if (res.secretKey) keyInput.value = res.secretKey;
    if (res.decryptMode) modeSelect.value = res.decryptMode;
  });

  saveBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    const mode = modeSelect.value;

    chrome.storage.local.set({ secretKey: key, decryptMode: mode }, () => {
      status.style.display = 'block';
      setTimeout(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0]) chrome.tabs.reload(tabs[0].id);
          window.close();
        });
      }, 400);
    });
  });
});
