// Offscreen Document — работает в фоне, невидим пользователю
// Получает streamId от background.js → захватывает аудио вкладки → транскрибирует

const BACKEND_URL = 'http://localhost:3000';

let recognition = null;
let sessionId = null;
let finalBuffer = '';
let silenceTimer = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'start_capture') {
    startCapture(msg.streamId, msg.sessionId);
    sendResponse({ ok: true });
  }

  if (msg.type === 'stop_capture') {
    stopCapture();
    sendResponse({ ok: true });
  }
});

async function startCapture(streamId, sid) {
  sessionId = sid || ('tab_' + Date.now());

  // Получаем MediaStream вкладки через streamId
  // Это ВЕСЬ аудио-микс встречи — обе стороны разговора
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
  } catch (err) {
    console.error('[Offscreen] getUserMedia error:', err);
    chrome.runtime.sendMessage({ type: 'capture_error', error: err.message });
    return;
  }

  console.log('[Offscreen] Tab audio stream captured — both sides of the call');

  // Запускаем Web Speech API на потоке вкладки
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    chrome.runtime.sendMessage({ type: 'capture_error', error: 'SpeechRecognition not supported' });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'ru-RU'; // можно сделать configurable

  // Привязываем SpeechRecognition к потоку вкладки
  // Chrome поддерживает нестандартное свойство .stream для этого
  if ('stream' in recognition) {
    recognition.stream = stream;
  }
  // Если не поддерживает — используем AudioContext для воспроизведения
  // чтобы SpeechRecognition мог захватить
  else {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    // Создаём новый поток для recognition
    recognition.stream = dest.stream;
  }

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

    // Шлём промежуточный текст в content.js для отображения
    if (interim || final) {
      chrome.runtime.sendMessage({
        type: 'transcript_interim',
        text: finalBuffer + (final || interim),
      });
    }

    if (final) {
      finalBuffer += final + ' ';

      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        const text = finalBuffer.trim();
        if (text.length > 8) {
          sendSegment(text);
          finalBuffer = '';
        }
      }, 1500); // 1.5 сек тишины — отправляем сегмент
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') {
      console.error('[Offscreen] Recognition error:', e.error);
    }
  };

  recognition.onend = () => {
    // Автоперезапуск — Google Chrome иногда останавливает recognition
    if (recognition) recognition.start();
  };

  recognition.start();
  console.log('[Offscreen] SpeechRecognition started on tab audio');
  chrome.runtime.sendMessage({ type: 'capture_started' });
}

async function sendSegment(text) {
  console.log('[Offscreen] Segment:', text.slice(0, 80));

  try {
    const res = await fetch(`${BACKEND_URL}/api/browser-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text, speaker: 'Auto' }),
    });
    const data = await res.json();

    if (data.hint) {
      // Отправляем подсказку в background → content.js
      chrome.runtime.sendMessage({ type: 'hint', hint: data.hint });
    }
  } catch (e) {
    console.error('[Offscreen] Backend error:', e.message);
  }
}

function stopCapture() {
  clearTimeout(silenceTimer);
  if (recognition) {
    recognition.onend = null; // отключаем автоперезапуск
    recognition.stop();
    recognition = null;
  }
  finalBuffer = '';
  sessionId = null;
  console.log('[Offscreen] Capture stopped');
}
