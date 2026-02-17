// Recruiter AI Coach — Content Script
// Только UI: оверлей с подсказками на Google Meet / Zoom
// Аудио захватывается в offscreen.js через tabCapture API

(function () {
  if (document.getElementById('rac-overlay')) return;

  // ── Overlay UI ────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'rac-overlay';
  overlay.innerHTML = `
    <div id="rac-header">
      <span>🎯 AI Coach</span>
      <div id="rac-dot"></div>
      <button id="rac-toggle">−</button>
    </div>
    <div id="rac-body">
      <div id="rac-transcript">
        <span id="rac-interim">Нажми ▶ в popup расширения...</span>
      </div>
      <div id="rac-hints-title">💡 Подсказки</div>
      <div id="rac-hints"></div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #rac-overlay {
      position: fixed; top: 20px; right: 20px; width: 300px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; border-radius: 12px; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55);
    }
    #rac-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; padding: 10px 14px;
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; cursor: move;
    }
    #rac-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: rgba(255,255,255,0.3); margin-left: auto;
      transition: background 0.3s;
    }
    #rac-dot.on { background: #4ade80; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    #rac-toggle {
      background: rgba(255,255,255,0.2); border: none; color: #fff;
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
    }
    #rac-body {
      background: rgba(13,13,13,0.96);
      backdrop-filter: blur(10px);
      padding: 10px;
      max-height: 380px; overflow-y: auto;
    }
    #rac-transcript {
      background: #111; border-radius: 6px; padding: 8px;
      font-size: 12px; color: #666; min-height: 36px;
      margin-bottom: 8px; line-height: 1.5;
    }
    #rac-interim { color: #888; }
    #rac-hints-title { font-size: 10px; color: #444; margin-bottom: 6px; }
    .rac-hint {
      background: #161616; border-left: 3px solid #6366f1;
      border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
      color: #e5e7eb; line-height: 1.55;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:none} }
    .rac-dismiss {
      float: right; background: none; border: none;
      color: #444; cursor: pointer; font-size: 15px; line-height: 1;
    }
    .rac-time { font-size: 10px; color: #444; margin-top: 5px; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  // ── Drag ─────────────────────────────────────────
  const header = document.getElementById('rac-header');
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'rac-toggle') return;
    dragging = true;
    const r = overlay.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    overlay.style.right = 'auto';
    overlay.style.left = (e.clientX - ox) + 'px';
    overlay.style.top = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // ── Collapse ─────────────────────────────────────
  let collapsed = false;
  document.getElementById('rac-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    document.getElementById('rac-body').style.display = collapsed ? 'none' : 'block';
    document.getElementById('rac-toggle').textContent = collapsed ? '+' : '−';
  });

  // ── Сообщения от background ───────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'hint') addHint(msg.hint);
    if (msg.type === 'transcript_interim') setInterim(msg.text);
    if (msg.type === 'status') updateStatus(msg.status);
  });

  function setInterim(text) {
    document.getElementById('rac-interim').textContent = text?.slice(-180) || '';
  }

  function updateStatus(status) {
    const dot = document.getElementById('rac-dot');
    if (status === 'listening') {
      dot.classList.add('on');
      setInterim('Слушаю...');
    } else {
      dot.classList.remove('on');
      if (status === 'stopped') setInterim('Остановлено');
      if (status === 'error') setInterim('Ошибка захвата — проверь консоль');
    }
  }

  function addHint(text) {
    const area = document.getElementById('rac-hints');
    const card = document.createElement('div');
    card.className = 'rac-hint';
    card.innerHTML = `
      <button class="rac-dismiss">×</button>
      ${text}
      <div class="rac-time">${new Date().toLocaleTimeString('ru')}</div>
    `;
    card.querySelector('.rac-dismiss').addEventListener('click', () => card.remove());
    area.insertBefore(card, area.firstChild);
    while (area.children.length > 5) area.removeChild(area.lastChild);
  }
})();
