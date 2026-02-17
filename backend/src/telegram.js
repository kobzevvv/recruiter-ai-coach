const TelegramBot = require('node-telegram-bot-api');
const fireflies = require('./fireflies');
const claude = require('./claude');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot = null;
let activeSessions = new Map(); // chatId → { sessionId, realtimeConnection }

function initBot(sessionManager) {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] BOT_TOKEN not set, Telegram bot disabled');
    return null;
  }

  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('[Telegram] Bot started');

  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      `👋 Recruiter AI Coach готов!\n\nКоманды:\n/active — активные митинги в Fireflies\n/connect <id> — подключиться к звонку\n/prep — подготовка к интервью\n/stop — остановить мониторинг\n\nТвой Chat ID: \`${chatId}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // /active — показать активные митинги
  bot.onText(/\/active/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      await bot.sendMessage(chatId, '🔍 Ищу активные митинги...');
      const meetings = await fireflies.getActiveMeetings();

      if (meetings.length === 0) {
        await bot.sendMessage(chatId, '😴 Нет активных митингов. Начни звонок и добавь Fireflies бота.');
        return;
      }

      const text = meetings
        .map((m, i) => `${i + 1}. *${m.title || 'Без названия'}*\nID: \`${m.id}\`\nСтатус: ${m.state}`)
        .join('\n\n');

      await bot.sendMessage(chatId, `📞 Активные митинги:\n\n${text}\n\nИспользуй /connect <id> для подключения`, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    }
  });

  // /recent — последние транскрипты
  bot.onText(/\/recent/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const transcripts = await fireflies.getRecentTranscripts(5);
      if (transcripts.length === 0) {
        await bot.sendMessage(chatId, 'Нет записей.');
        return;
      }
      const text = transcripts
        .map((t) => `• *${t.title}*\nID: \`${t.id}\`\n${new Date(t.date).toLocaleDateString('ru')}`)
        .join('\n\n');
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  });

  // /connect <transcriptId>
  bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const transcriptId = match[1].trim();
    const sessionId = `${chatId}_${transcriptId}`;

    // Закрыть предыдущее соединение если есть
    if (activeSessions.has(chatId)) {
      const prev = activeSessions.get(chatId);
      prev.realtimeConnection?.disconnect();
      claude.clearSession(prev.sessionId);
    }

    await bot.sendMessage(chatId, `🔗 Подключаюсь к митингу \`${transcriptId}\`...`, {
      parse_mode: 'Markdown',
    });

    const connection = fireflies.connectRealtime(
      transcriptId,
      // onTranscription
      async (segment) => {
        claude.addToContext(sessionId, segment);

        // Генерируем подсказку
        const hint = await claude.generateHint(sessionId, segment);
        if (hint) {
          await sendHint(chatId, hint);
        }
      },
      // onStatus
      async (status) => {
        const statusMessages = {
          connected: '🔌 Соединение установлено...',
          authenticated: '✅ Авторизован в Fireflies',
          listening: '👂 Слушаю разговор! Подсказки придут автоматически.',
          auth_failed: '❌ Ошибка авторизации Fireflies. Проверь API ключ.',
          disconnected: '🔴 Соединение разорвано.',
          error: '⚠️ Ошибка соединения.',
        };
        if (statusMessages[status]) {
          await bot.sendMessage(chatId, statusMessages[status]);
        }
      }
    );

    activeSessions.set(chatId, { sessionId, realtimeConnection: connection });

    // Также уведомить session manager
    if (sessionManager) {
      sessionManager.addSession(sessionId, { transcriptId, chatId, type: 'telegram' });
    }
  });

  // /stop
  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    if (activeSessions.has(chatId)) {
      const session = activeSessions.get(chatId);
      session.realtimeConnection?.disconnect();
      claude.clearSession(session.sessionId);
      activeSessions.delete(chatId);
      await bot.sendMessage(chatId, '⏹ Мониторинг остановлен.');
    } else {
      await bot.sendMessage(chatId, 'Нет активной сессии.');
    }
  });

  // /prep — подготовка к интервью
  bot.onText(/\/prep/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      '📋 Для подготовки к интервью отправь данные в формате:\n\n`/prepdata <роль>|<CV кандидата>|<описание вакансии>`\n\nИли используй API endpoint: POST /api/prepare',
      { parse_mode: 'Markdown' }
    );
  });

  // /prepdata
  bot.onText(/\/prepdata (.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].split('|');
    if (parts.length < 3) {
      await bot.sendMessage(chatId, '❌ Формат: /prepdata <роль>|<CV>|<JD>');
      return;
    }
    const [role, cv, jd] = parts;

    await bot.sendMessage(chatId, '⏳ Генерирую prep kit...');

    try {
      const prepKit = await claude.generatePrepKit(cv, jd, role);
      // Разбиваем на части если длинный (Telegram лимит 4096 символов)
      if (prepKit.length > 4000) {
        const chunks = prepKit.match(/.{1,4000}/gs) || [];
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, prepKit, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      await bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  });

  return bot;
}

// Отправить подсказку в указанный чат
async function sendHint(chatId, hint) {
  if (!bot) return;
  try {
    await bot.sendMessage(chatId, hint, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Telegram] Failed to send hint:', err.message);
  }
}

// Отправить сообщение в дефолтный чат (из .env)
async function notify(text) {
  if (!bot || !CHAT_ID) return;
  await sendHint(CHAT_ID, text);
}

module.exports = { initBot, sendHint, notify };
