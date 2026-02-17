// Recruiter AI Coach — Content Script
// Overlay с подсказками поверх Google Meet / Zoom

(function () {
  if (document.getElementById('rac-overlay')) return; // уже вставлен

  // ── Создать overlay ────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'rac-overlay';
  overlay.innerHTML = `
    <div id="rac-header">
      <span>🎯 AI Coach</span>
      <button id="rac-toggle">−</button>
    </div>
    <div id="rac-body">
      <div id="rac-hints"></div>
      <div id="rac-empty">Подсказки появятся автоматически</div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #rac-overlay {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 300px;
      max-height: 400px;
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      user-select: none;
    }
    #rac-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      cursor: move;
    }
    #rac-toggle {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    }
    #rac-body {
      background: rgba(15,15,15,0.95);
      backdrop-filter: blur(8px);
      padding: 10px;
      overflow-y: auto;
      max-height: 340px;
    }
    #rac-empty {
      color: #555;
      text-align: center;
      padding: 20px 0;
      font-size: 12px;
    }
    .rac-hint {
      background: #1a1a1a;
      border-left: 3px solid #6366f1;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
      color: #e5e7eb;
      line-height: 1.5;
      animation: racSlideIn 0.3s ease;
    }
    @keyframes racSlideIn {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .rac-dismiss {
      float: right;
      background: none;
      border: none;
      color: #555;
      cursor: pointer;
      font-size: 14px;
      padding: 0 0 0 8px;
    }
    .rac-time { font-size: 10px; color: #555; margin-top: 4px; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  // ── Toggle collapse ────────────────────────────────
  let collapsed = false;
  document.getElementById('rac-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    document.getElementById('rac-body').style.display = collapsed ? 'none' : 'block';
    document.getElementById('rac-toggle').textContent = collapsed ? '+' : '−';
  });

  // ── Drag to move ───────────────────────────────────
  const header = document.getElementById('rac-header');
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', (e) => {
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

  // ── Слушаем подсказки от background ───────────────
  let hintCount = 0;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'hint') {
      addHint(msg.hint);
    }
  });

  function addHint(text) {
    const hintsEl = document.getElementById('rac-hints');
    const emptyEl = document.getElementById('rac-empty');

    emptyEl.style.display = 'none';
    hintCount++;

    const card = document.createElement('div');
    card.className = 'rac-hint';
    card.innerHTML = `
      <button class="rac-dismiss" title="Закрыть">×</button>
      ${text}
      <div class="rac-time">${new Date().toLocaleTimeString('ru')}</div>
    `;
    card.querySelector('.rac-dismiss').addEventListener('click', () => {
      card.remove();
      if (hintsEl.children.length === 0) emptyEl.style.display = 'block';
    });

    hintsEl.insertBefore(card, hintsEl.firstChild);

    // Ограничиваем 5 карточек
    while (hintsEl.children.length > 5) {
      hintsEl.removeChild(hintsEl.lastChild);
    }
  }
})();
