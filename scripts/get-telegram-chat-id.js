#!/usr/bin/env node
// Запусти этот скрипт, напиши /start боту в Telegram, и здесь появится твой chat_id
// node scripts/get-telegram-chat-id.js

const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(`${backendDir}/node_modules/dotenv`).config({ path: path.join(__dirname, '../.env') });
const TelegramBot = require(`${backendDir}/node_modules/node-telegram-bot-api`);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

console.log('✅ Бот запущен: @recruiter_realtime_helper_bot');
console.log('👉 Напиши /start боту в Telegram — здесь появится твой Chat ID\n');

bot.on('message', (msg) => {
  console.log(`📱 Chat ID: ${msg.chat.id}`);
  console.log(`   Имя: ${msg.from.first_name} ${msg.from.last_name || ''}`);
  console.log(`\n✅ Добавь в .env:`);
  console.log(`   TELEGRAM_CHAT_ID=${msg.chat.id}`);
  process.exit(0);
});
