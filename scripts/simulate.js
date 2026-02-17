#!/usr/bin/env node
// Симуляция интервью — отправляет реплики в Telegram с подсказками от GPT-4o
// node scripts/simulate.js

const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(`${backendDir}/node_modules/dotenv`).config({ path: path.join(__dirname, '../.env') });

const OpenAI = require(`${backendDir}/node_modules/openai`);
const TelegramBot = require(`${backendDir}/node_modules/node-telegram-bot-api`);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SYSTEM_PROMPT = `Ты — AI-ассистент для рекрутера во время технического собеседования.
Смотришь на диалог и генерируешь КРАТКУЮ подсказку рекрутеру (1-2 предложения).

Типы подсказок:
🔍 УТОЧНИ — кандидат говорит расплывчато
❓ ВОПРОС — конкретный follow-up ("Vue или React?", "Redux или Zustand?")
🚩 ФЛАГ — противоречие или красный флаг
✅ ПОЗИТИВ — сильный ответ

Отвечай ТОЛЬКО если есть что-то важное. Если всё нормально — пустую строку.`;

const dialogue = [
  { speaker: 'Рекрутер', text: 'Расскажи про свой опыт с фронтенд-фреймворками' },
  { speaker: 'Кандидат', text: 'Ну я работал с реактом, вюшкой, в общем со всем понемножку' },
  { speaker: 'Рекрутер', text: 'А какой стейт-менеджмент использовал?' },
  { speaker: 'Кандидат', text: 'Редакс в основном, ну там всякое разное было' },
  { speaker: 'Рекрутер', text: 'Расскажи про последний проект' },
  { speaker: 'Кандидат', text: 'Делал интернет-магазин, там были компоненты, апи, база данных, в общем стандартное всё' },
  { speaker: 'Рекрутер', text: 'А как у тебя с TypeScript?' },
  { speaker: 'Кандидат', text: 'Да, использовал TypeScript, знаю его хорошо, типы и всё такое' },
  { speaker: 'Рекрутер', text: 'Как деплоили проект?' },
  { speaker: 'Кандидат', text: 'Через докер, CI/CD было настроено, в облако деплоили' },
];

async function send(text) {
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  console.log('TG:', text.slice(0, 60));
}

async function main() {
  await send('🎬 *Симуляция интервью — Frontend Engineer*\nПодсказки придут автоматически после реплик кандидата...\n');

  let context = [];

  for (const seg of dialogue) {
    await new Promise(r => setTimeout(r, 2000));

    // Показываем реплику
    const icon = seg.speaker === 'Рекрутер' ? '👔' : '👤';
    await send(`${icon} *${seg.speaker}:* ${seg.text}`);

    context.push(`${seg.speaker}: ${seg.text}`);

    // Генерируем подсказку только после реплик кандидата
    if (seg.speaker !== 'Кандидат') continue;

    const recentContext = context.slice(-6).join('\n');

    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 150,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: recentContext },
        ],
      });

      const hint = res.choices[0]?.message?.content?.trim();
      if (hint && hint.length > 3) {
        await new Promise(r => setTimeout(r, 800));
        await send(`💡 *Подсказка:* ${hint}`);
      }
    } catch (e) {
      console.error('OpenAI error:', e.message);
    }
  }

  await send('✅ *Симуляция завершена!*\n\nДля реального звонка:\n1. Запусти сервер: `cd backend && npm start`\n2. В боте: /active → /connect <id>');
  console.log('Done!');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
