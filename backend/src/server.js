require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const fireflies = require('./fireflies');
const claude = require('./claude');
const { initBot } = require('./telegram');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Session manager
const sessions = new Map(); // sessionId → { transcriptId, realtimeConnection, clients: Set }

function addSession(sessionId, meta) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { ...meta, clients: new Set() });
  }
}

// ──────────────────────────────────────────────────
// REST API
// ──────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', sessions: sessions.size }));

// Список активных митингов из Fireflies
app.get('/api/meetings/active', async (req, res) => {
  try {
    const meetings = await fireflies.getActiveMeetings();
    res.json({ meetings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Последние транскрипты
app.get('/api/meetings/recent', async (req, res) => {
  try {
    const transcripts = await fireflies.getRecentTranscripts(10);
    res.json({ transcripts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Начать сессию мониторинга
app.post('/api/session/start', async (req, res) => {
  const { transcriptId, prepContext } = req.body;
  if (!transcriptId) {
    return res.status(400).json({ error: 'transcriptId required' });
  }

  const sessionId = `session_${transcriptId}`;

  // Если сессия уже есть — переподключаемся
  if (sessions.has(sessionId)) {
    return res.json({ sessionId, status: 'already_active' });
  }

  if (prepContext) {
    claude.setPrepContext(sessionId, prepContext);
  }

  const connection = fireflies.connectRealtime(
    transcriptId,
    async (segment) => {
      claude.addToContext(sessionId, segment);

      // Отправляем сегмент всем WebSocket клиентам этой сессии
      io.to(sessionId).emit('transcription', segment);

      // Буферизуем сегмент для polling (Chrome Extension)
      const sess = sessions.get(sessionId);
      if (sess) {
        sess.segmentsBuffer.push({ ...segment, timestamp: new Date().toISOString() });
        if (sess.segmentsBuffer.length > 50) sess.segmentsBuffer.shift();
      }

      // Генерируем подсказку
      const hint = await claude.generateHint(sessionId, segment);
      if (hint) {
        const hintObj = { hint, timestamp: new Date().toISOString() };
        console.log(`[Session ${sessionId}] Hint: ${hint}`);
        io.to(sessionId).emit('hint', hintObj);
        // Буферизуем для polling
        if (sess) {
          sess.hintsBuffer.push(hintObj);
          if (sess.hintsBuffer.length > 20) sess.hintsBuffer.shift();
        }
      }
    },
    (status) => {
      io.to(sessionId).emit('status', { status });
    }
  );

  sessions.set(sessionId, {
    transcriptId,
    realtimeConnection: connection,
    clients: new Set(),
    hintsBuffer: [],   // для polling от Chrome Extension
    segmentsBuffer: [],
  });
  addSession(sessionId, { transcriptId });

  res.json({ sessionId, status: 'started' });
});

// Остановить сессию
app.post('/api/session/stop', (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  session.realtimeConnection?.disconnect();
  claude.clearSession(sessionId);
  sessions.delete(sessionId);
  res.json({ status: 'stopped' });
});

// Браузерный сегмент речи (из Chrome Extension Web Speech API)
app.post('/api/browser-segment', async (req, res) => {
  const { sessionId, text, speaker } = req.body;
  if (!text) return res.json({ hint: null });

  const segment = { chunkId: `browser_${Date.now()}`, text, speaker: speaker || 'Speaker', timestamp: new Date().toISOString() };
  claude.addToContext(sessionId, segment);

  const hint = await claude.generateHint(sessionId, segment);

  // Отправить в Telegram тоже
  if (hint) {
    const { sendHint } = require('./telegram');
    sendHint(process.env.TELEGRAM_CHAT_ID, hint).catch(() => {});
  }

  res.json({ hint });
});

// Отправить подсказку напрямую в Telegram (из content script)
app.post('/api/hint-to-telegram', async (req, res) => {
  const { hint } = req.body;
  if (hint) {
    const { sendHint } = require('./telegram');
    await sendHint(process.env.TELEGRAM_CHAT_ID, hint).catch(() => {});
  }
  res.json({ ok: true });
});

// Pre-interview подготовка
app.post('/api/prepare', async (req, res) => {
  const { candidateCV, jobDescription, role } = req.body;
  if (!candidateCV || !jobDescription || !role) {
    return res.status(400).json({ error: 'candidateCV, jobDescription, role required' });
  }

  try {
    const prepKit = await claude.generatePrepKit(candidateCV, jobDescription, role);
    res.json({ prepKit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Polling endpoint для Chrome Extension (hints + segments since timestamp)
app.get('/api/session/:sessionId/hints', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const since = req.query.since || null;
  const hints = since
    ? session.hintsBuffer.filter((h) => h.timestamp > since)
    : session.hintsBuffer.slice(-5);
  const segments = since
    ? session.segmentsBuffer.filter((s) => s.timestamp > since)
    : session.segmentsBuffer.slice(-10);

  res.json({ hints, segments });
});

// Тест-симуляция: прогоняем диалог через Claude и отправляем подсказки в Telegram
app.post('/api/test/simulate', async (req, res) => {
  const sessionId = 'test_session';
  claude.clearSession(sessionId);

  const { sendHint } = require('./telegram');
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  await sendHint(CHAT_ID, '🎬 *Симуляция интервью запущена!*\nСейчас пойдут реплики кандидата...');

  const dialogue = [
    { speaker: 'Recruiter', text: 'Расскажи про свой опыт с фронтенд-фреймворками' },
    { speaker: 'Candidate', text: 'Ну я работал с реактом, вюшкой, в общем со всем понемножку' },
    { speaker: 'Recruiter', text: 'Понятно. А какой стейт-менеджмент использовал?' },
    { speaker: 'Candidate', text: 'Редакс в основном, ну там всякое разное' },
    { speaker: 'Recruiter', text: 'Хорошо. Расскажи про последний проект' },
    { speaker: 'Candidate', text: 'Делал интернет-магазин, там были компоненты, апи, база данных, в общем всё стандартное' },
    { speaker: 'Recruiter', text: 'А как у тебя с TypeScript?' },
    { speaker: 'Candidate', text: 'Да, использовал TypeScript, знаю его хорошо, типы там и всё такое' },
    { speaker: 'Recruiter', text: 'Как вы деплоили проект?' },
    { speaker: 'Candidate', text: 'Через докер, CI/CD было настроено, в облако деплоили' },
  ];

  res.json({ status: 'started', segments: dialogue.length });

  // Прогоняем диалог с задержками
  for (const seg of dialogue) {
    await new Promise((r) => setTimeout(r, 1500));
    await sendHint(CHAT_ID, `💬 *${seg.speaker}:* ${seg.text}`);
    claude.addToContext(sessionId, seg);

    // Сбрасываем throttle для теста (каждые 3 реплики)
    const ctx = claude.getContext ? claude.getContext(sessionId) : null;

    const hint = await claude.generateHint(sessionId, seg, { noThrottle: true });
    if (hint) {
      await new Promise((r) => setTimeout(r, 500));
      await sendHint(CHAT_ID, hint);
    }
  }

  await sendHint(CHAT_ID, '✅ *Симуляция завершена!*');
});

// Получить транскрипт из Fireflies
app.get('/api/transcript/:id', async (req, res) => {
  try {
    const transcript = await fireflies.getTranscript(req.params.id);
    res.json({ transcript });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────
// WebSocket (для Chrome Extension)
// ──────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);

  // Клиент подписывается на сессию
  socket.on('join_session', ({ sessionId }) => {
    socket.join(sessionId);
    console.log(`[WS] Client ${socket.id} joined session ${sessionId}`);

    const session = sessions.get(sessionId);
    if (session) {
      socket.emit('status', { status: 'joined' });
    } else {
      socket.emit('status', { status: 'session_not_found' });
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// ──────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n🚀 Recruiter AI Coach backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Active meetings: http://localhost:${PORT}/api/meetings/active`);
  console.log('');

  // Инициализируем Telegram бота
  initBot({ addSession });
});
