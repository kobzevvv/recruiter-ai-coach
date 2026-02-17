// Recruiter AI Coach — Content Script
// Встраивается в Google Meet/Zoom
// Использует Web Speech API для транскрипции прямо в браузере

(function () {
  if (document.getElementById('rac-overlay')) return;

  const BACKEND_URL = 'http://localhost:3000';
  let sessionId = null;
  let recognition = null;
  let isListening = false;

  // ── Overlay UI ─────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'rac-overlay';
  overlay.innerHTML = `
    <div id="rac-header">
      <span>🎯 AI Coach</span>
      <div id="rac-status-dot"></div>
      <button id="rac-toggle">−</button>
    </div>
    <div id="rac-body">
      <div id="rac-controls">
        <button id="rac-start-btn">▶ Начать запись</button>
      </div>
      <div id="rac-transcript-box">
        <div id="rac-transcript-label">Транскрипция:</div>
        <div id="rac-transcript-text">—</div>
      </div>
      <div id="rac-hints-label">💡 Подсказки:</div>
      <div id="rac-hints"></div>
      <div id="rac-empty">Нажми ▶ и говори...</div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #rac-overlay {
      position: fixed; top: 20px; right: 20px; width: 300px;
      z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; border-radius: 12px; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); user-select: none;
    }
    #rac-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; padding: 10px 14px;
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; cursor: move;
    }
    #rac-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #555; margin-left: auto;
    }
    #rac-status-dot.active { background: #22c55e; animation: racPulse 1.5s infinite; }
    @keyframes racPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    #rac-toggle {
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 14px;
    }
    #rac-body {
      background: rgba(15,15,15,0.95); backdrop-filter: blur(8px);
      padding: 10px; max-height: 380px; overflow-y: auto;
    }
    #rac-controls { margin-bottom: 8px; }
    #rac-start-btn {
      width: 100%; padding: 8px; background: #6366f1; color: #fff;
      border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
    }
    #rac-start-btn.recording { background: #ef4444; }
    #rac-transcript-box {
      background: #111; border-radius: 6px; padding: 8px; margin-bottom: 8px; min-height: 40px;
    }
    #rac-transcript-label { font-size: 10px; color: #555; margin-bottom: 4px; }
    #rac-transcript-text { color: #aaa; font-size: 12px; line-height: 1.5; }
    #rac-hints-label { font-size: 10px; color: #555; margin-bottom: 6px; }
    #rac-empty { color: #555; text-align: center; padding: 12px 0; font-size: 12px; }
    .rac-hint {
      background: #1a1a1a; border-left: 3px solid #6366f1;
      border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
      color: #e5e7eb; line-height: 1.5;
      animation: racIn 0.3s ease;
    }
    @keyframes racIn { from { opacity:0; transform: translateX(10px); } to { opacity:1; transform: translateX(0); } }
    .rac-dismiss {
      float: right; background: none; border: none; color: #555; cursor: pointer; font-size: 14px; padding: 0;
    }
    .rac-time { font-size: 10px; color: #555; margin-top: 4px; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  // ── Drag ───────────────────────────────────────────
  const header = document.getElementById('rac-header');
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'rac-toggle' || e.target.id === 'rac-start-btn') return;
    dragging = true;
    ox = e.clientX - overlay.getBoundingClientRect().left;
    oy = e.clientY - overlay.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    overlay.style.left = (e.clientX - ox) + 'px';
    overlay.style.top = (e.clientY - oy) + 'px';
    overlay.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // ── Collapse ────────────────────────────────────────
  let collapsed = false;
  document.getElementById('rac-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    document.getElementById('rac-body').style.display = collapsed ? 'none' : 'block';
    document.getElementById('rac-toggle').textContent = collapsed ? '+' : '−';
  });

  // ── Web Speech API ─────────────────────────────────
  document.getElementById('rac-start-btn').addEventListener('click', () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  function startListening() {
    sessionId = 'browser_' + Date.now();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addHint('❌ Web Speech API не поддерживается в этом браузере');
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ru-RU';

    recognition.onstart = () => {
      isListening = true;
      document.getElementById('rac-start-btn').textContent = '⏹ Остановить';
      document.getElementById('rac-start-btn').classList.add('recording');
      document.getElementById('rac-status-dot').classList.add('active');
      document.getElementById('rac-empty').style.display = 'none';
    };

    let finalBuffer = '';
    let silenceTimer = null;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      // Показываем промежуточный результат
      document.getElementById('rac-transcript-text').textContent =
        (finalBuffer + final || interim || '...').slice(-200);

      if (final) {
        finalBuffer += final + ' ';

        // Сбрасываем таймер тишины
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (finalBuffer.trim().length > 10) {
            sendSegment(finalBuffer.trim());
            finalBuffer = '';
          }
        }, 2000); // отправляем после 2 сек тишины
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.error('Speech error:', e.error);
    };

    recognition.onend = () => {
      // Автоперезапуск если ещё слушаем
      if (isListening) recognition.start();
    };

    recognition.start();
  }

  function stopListening() {
    isListening = false;
    recognition?.stop();
    document.getElementById('rac-start-btn').textContent = '▶ Начать запись';
    document.getElementById('rac-start-btn').classList.remove('recording');
    document.getElementById('rac-status-dot').classList.remove('active');
  }

  async function sendSegment(text) {
    console.log('[RAC] Sending segment:', text);
    try {
      const res = await fetch(`${BACKEND_URL}/api/browser-segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, speaker: 'Speaker' }),
      });
      const data = await res.json();
      if (data.hint) addHint(data.hint);
    } catch (e) {
      console.error('[RAC] Backend error:', e.message);
    }
  }

  function addHint(text) {
    const hintsEl = document.getElementById('rac-hints');
    document.getElementById('rac-empty').style.display = 'none';

    const card = document.createElement('div');
    card.className = 'rac-hint';
    card.innerHTML = `
      <button class="rac-dismiss">×</button>
      ${text}
      <div class="rac-time">${new Date().toLocaleTimeString('ru')}</div>
    `;
    card.querySelector('.rac-dismiss').addEventListener('click', () => card.remove());
    hintsEl.insertBefore(card, hintsEl.firstChild);

    while (hintsEl.children.length > 5) hintsEl.removeChild(hintsEl.lastChild);

    // Также отправить в Telegram
    fetch(`${BACKEND_URL}/api/hint-to-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hint: text }),
    }).catch(() => {});
  }

  // Слушаем подсказки от background (через Fireflies, если есть)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'hint') addHint(msg.hint);
  });

})();
