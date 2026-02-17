const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  const { isCapturing } = await chrome.runtime.sendMessage({ type: 'get_status' }) || {};
  if (isCapturing) setActive(true);
});

$('startBtn').addEventListener('click', async () => {
  const btn = $('startBtn');
  btn.disabled = true;
  btn.textContent = 'Подключаюсь...';

  const res = await chrome.runtime.sendMessage({ type: 'start_capture' });

  if (res?.error) {
    $('status').textContent = '❌ ' + res.error;
    btn.disabled = false;
    btn.textContent = '▶ Начать';
    return;
  }

  setActive(true);
  $('status').textContent = '✅ Слушаю оба голоса...';
});

$('stopBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop_capture' });
  setActive(false);
  $('status').textContent = 'Остановлено';
});

function setActive(active) {
  $('startBtn').style.display = active ? 'none' : 'block';
  $('stopBtn').style.display = active ? 'block' : 'none';
  $('startBtn').disabled = false;
  $('startBtn').textContent = '▶ Начать';
  $('dot').className = active ? 'dot on' : 'dot';
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    if (msg.status === 'listening') {
      setActive(true);
      $('status').textContent = '✅ Слушаю оба голоса...';
    }
    if (msg.status === 'stopped' || msg.status === 'error') {
      setActive(false);
      $('status').textContent = msg.error || 'Остановлено';
    }
  }
});
