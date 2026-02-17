// Recruiter AI Coach — Service Worker (background.js)
// Управляет захватом вкладки через tabCapture + offscreen document

const BACKEND_URL = 'http://localhost:3000';

let isCapturing = false;
let currentTabId = null;
let offscreenReady = false;

// ── Слушаем сообщения от popup и offscreen ──────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'start_capture') {
    startTabCapture().then(sendResponse);
    return true; // async
  }

  if (msg.type === 'stop_capture') {
    stopTabCapture().then(sendResponse);
    return true;
  }

  if (msg.type === 'get_status') {
    sendResponse({ isCapturing, tabId: currentTabId });
    return;
  }

  // Сообщения от offscreen → пересылаем в content.js
  if (msg.type === 'hint') {
    broadcastToMeetTab({ type: 'hint', hint: msg.hint });
    return;
  }

  if (msg.type === 'transcript_interim') {
    broadcastToMeetTab({ type: 'transcript_interim', text: msg.text });
    return;
  }

  if (msg.type === 'capture_started') {
    isCapturing = true;
    broadcastToMeetTab({ type: 'status', status: 'listening' });
    return;
  }

  if (msg.type === 'capture_error') {
    isCapturing = false;
    broadcastToMeetTab({ type: 'status', status: 'error', error: msg.error });
    console.error('[Background] Capture error:', msg.error);
    return;
  }
});

// ── Основная логика tabCapture ───────────────────────
async function startTabCapture() {
  try {
    // Найти активную вкладку с Meet или Zoom
    const [tab] = await chrome.tabs.query({
      active: true,
      url: ['https://meet.google.com/*', 'https://zoom.us/*']
    });

    if (!tab) {
      // Если активная вкладка не Meet/Zoom — ищем любую Meet/Zoom вкладку
      const tabs = await chrome.tabs.query({
        url: ['https://meet.google.com/*', 'https://zoom.us/*']
      });
      if (!tabs.length) {
        return { error: 'Открой Google Meet или Zoom в браузере' };
      }
    }

    const targetTab = tab || (await chrome.tabs.query({
      url: ['https://meet.google.com/*', 'https://zoom.us/*']
    }))[0];

    currentTabId = targetTab.id;

    // Получаем streamId для вкладки (не MediaStream — он не работает в service worker)
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: currentTabId },
        (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(id);
        }
      );
    });

    // Создаём offscreen document если нет
    await ensureOffscreen();

    // Передаём streamId в offscreen — там захватят аудио и запустят транскрипцию
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'start_capture',
      streamId,
      sessionId: 'tab_' + currentTabId,
    });

    return { ok: true, tabId: currentTabId };

  } catch (err) {
    console.error('[Background] startTabCapture error:', err);
    return { error: err.message };
  }
}

async function stopTabCapture() {
  isCapturing = false;
  currentTabId = null;

  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'stop_capture',
  }).catch(() => {});

  broadcastToMeetTab({ type: 'status', status: 'stopped' });
  return { ok: true };
}

// ── Offscreen document management ───────────────────
async function ensureOffscreen() {
  if (offscreenReady) return;

  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) {
    offscreenReady = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Transcribe tab audio for recruiter AI hints',
  });

  offscreenReady = true;
}

// ── Broadcast в content.js на вкладке Meet/Zoom ─────
function broadcastToMeetTab(message) {
  chrome.tabs.query(
    { url: ['https://meet.google.com/*', 'https://zoom.us/*'] },
    (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      });
    }
  );

  // Также в popup если открыт
  chrome.runtime.sendMessage(message).catch(() => {});
}
