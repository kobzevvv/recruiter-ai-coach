// Recruiter AI Coach — Popup JS
// Коммуникация через background.js service worker

const $ = (id) => document.getElementById(id);

let hints = [];
let transcriptLines = [];

// ── Инициализация ──────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Загрузить сохранённые настройки
  const { backendUrl, transcriptId, sessionId, isActive } = await chrome.storage.local.get([
    'backendUrl', 'transcriptId', 'sessionId', 'isActive'
  ]);

  if (backendUrl) $('backendUrl').value = backendUrl;
  if (transcriptId) $('transcriptId').value = transcriptId;

  if (isActive && sessionId) {
    showActiveSession(sessionId, backendUrl, transcriptId);
  }

  // Загрузить сохранённые подсказки
  const { savedHints } = await chrome.storage.local.get('savedHints');
  if (savedHints?.length) {
    hints = savedHints;
    renderHints();
  }

  // Слушаем сообщения от background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'hint') addHint(msg.hint);
    if (msg.type === 'transcription') addTranscript(msg.segment);
    if (msg.type === 'status') updateStatus(msg.status);
  });
});

// ── Кнопки ──────────────────────────────────────────

$('connectBtn').addEventListener('click', async () => {
  const backendUrl = $('backendUrl').value.trim();
  const transcriptId = $('transcriptId').value.trim();

  if (!transcriptId) {
    alert('Введи Transcript ID или выбери из списка митингов');
    return;
  }

  await chrome.storage.local.set({ backendUrl, transcriptId });

  // Отправляем команду в background
  const response = await chrome.runtime.sendMessage({
    type: 'start_session',
    backendUrl,
    transcriptId,
  });

  if (response?.error) {
    alert('Ошибка: ' + response.error);
  } else {
    showActiveSession(response.sessionId, backendUrl, transcriptId);
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop_session' });
  showConnectForm();
  await chrome.storage.local.set({ isActive: false, sessionId: null });
});

$('loadMeetingsBtn').addEventListener('click', async () => {
  const backendUrl = $('backendUrl').value.trim();
  const section = $('meetingsSection');
  const list = $('meetingsList');

  list.innerHTML = '<div class="empty-state">Загрузка...</div>';
  section.style.display = 'block';

  try {
    const res = await fetch(`${backendUrl}/api/meetings/active`);
    const { meetings } = await res.json();

    if (!meetings?.length) {
      list.innerHTML = '<div class="empty-state">Нет активных митингов</div>';
      return;
    }

    list.innerHTML = '';
    meetings.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'meeting-item';
      div.innerHTML = `
        <div class="meeting-name">${m.title || 'Без названия'}</div>
        <div class="meeting-id">${m.id}</div>
      `;
      div.addEventListener('click', () => {
        $('transcriptId').value = m.id;
        section.style.display = 'none';
      });
      list.appendChild(div);
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state">Ошибка: ${err.message}</div>`;
  }
});

$('prepBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('prep.html') });
});

// ── Рендер ───────────────────────────────────────────

function showActiveSession(sessionId, backendUrl, transcriptId) {
  $('connectSection').style.display = 'none';
  $('meetingsSection').style.display = 'none';
  $('sessionSection').style.display = 'block';
  $('transcriptSection').style.display = 'block';

  $('sessionInfo').textContent = `Session: ${sessionId?.split('_')[1] || transcriptId}`;
  updateStatus('listening');

  chrome.storage.local.set({ isActive: true, sessionId });
}

function showConnectForm() {
  $('connectSection').style.display = 'block';
  $('sessionSection').style.display = 'none';
  $('transcriptSection').style.display = 'none';
  updateStatus('offline');
}

function updateStatus(status) {
  const badge = $('statusBadge');
  const labels = {
    offline: 'Offline',
    connected: 'Connecting...',
    authenticated: 'Auth OK',
    listening: '🔴 Live',
    disconnected: 'Disconnected',
    error: 'Error',
  };
  badge.textContent = labels[status] || status;
  badge.className = 'status-badge' + (status === 'listening' ? ' active' : '');
}

function addHint(hint) {
  hints.unshift({ text: hint, time: new Date().toLocaleTimeString('ru') });
  if (hints.length > 20) hints = hints.slice(0, 20);
  chrome.storage.local.set({ savedHints: hints });
  renderHints();
}

function renderHints() {
  const area = $('hintsArea');
  if (!hints.length) {
    area.innerHTML = '<div class="empty-state">Подсказки появятся автоматически</div>';
    return;
  }
  area.innerHTML = hints
    .map((h) => `<div class="hint-card">${h.text}<div class="hint-time">${h.time}</div></div>`)
    .join('');
}

function addTranscript(segment) {
  transcriptLines.push(segment);
  if (transcriptLines.length > 30) transcriptLines = transcriptLines.slice(-30);

  const area = $('transcriptArea');
  area.innerHTML = transcriptLines
    .slice(-8)
    .map((s) => `<div class="transcript-line"><span class="transcript-speaker">${s.speaker}:</span> ${s.text}</div>`)
    .join('');
  area.scrollTop = area.scrollHeight;
}
