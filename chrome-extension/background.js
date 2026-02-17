// Recruiter AI Coach — Service Worker
// Управляет WebSocket соединением с backend и рассылает события в popup/content

let socket = null;
let currentSessionId = null;
let backendUrl = 'http://localhost:3000';

// Слушаем сообщения от popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start_session') {
    startSession(msg.backendUrl, msg.transcriptId).then(sendResponse);
    return true; // async
  }
  if (msg.type === 'stop_session') {
    stopSession();
    sendResponse({ status: 'stopped' });
  }
  if (msg.type === 'get_status') {
    sendResponse({ sessionId: currentSessionId, connected: !!socket });
  }
});

async function startSession(url, transcriptId) {
  backendUrl = url;

  // Остановить предыдущую сессию
  if (socket) stopSession();

  try {
    // Запустить сессию на backend
    const res = await fetch(`${backendUrl}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcriptId }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start session');

    currentSessionId = data.sessionId;

    // Подключиться к WebSocket
    connectWebSocket(currentSessionId);

    return { sessionId: currentSessionId };
  } catch (err) {
    console.error('[Background] Start session error:', err);
    return { error: err.message };
  }
}

function connectWebSocket(sessionId) {
  // Используем динамический import для socket.io-client в service worker
  // В MV3 нельзя использовать require(), поэтому подключаем через importScripts
  // Для простоты используем нативный WebSocket с fallback

  const wsUrl = backendUrl.replace(/^http/, 'ws');

  // Попытка через socket.io (если доступен)
  // В production здесь был бы полноценный socket.io-client
  // MVP: используем polling через fetch

  broadcast('status', { status: 'listening' });

  // Polling hints каждые 2 секунды (временное решение пока нет WS в MV3)
  startPolling(sessionId);
}

let pollInterval = null;
let lastHintTs = null;

function startPolling(sessionId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${backendUrl}/api/session/${sessionId}/hints?since=${lastHintTs || ''}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.hints?.length) {
        data.hints.forEach((h) => {
          broadcast('hint', { hint: h.hint });
          lastHintTs = h.timestamp;
        });
      }
      if (data.segments?.length) {
        data.segments.forEach((s) => broadcast('transcription', { segment: s }));
      }
    } catch (err) {
      // silently ignore network errors during polling
    }
  }, 2000);
}

function stopSession() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (socket) {
    socket.disconnect?.();
    socket = null;
  }
  if (currentSessionId) {
    fetch(`${backendUrl}/api/session/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId }),
    }).catch(() => {});
  }
  currentSessionId = null;
  broadcast('status', { status: 'disconnected' });
}

// Разослать сообщение во все вкладки и popup
function broadcast(type, data) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {});

  // Также в content scripts на активных вкладках
  chrome.tabs.query({ url: ['https://meet.google.com/*', 'https://zoom.us/*'] }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { type, ...data }).catch(() => {});
    });
  });
}
