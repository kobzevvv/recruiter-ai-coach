#!/usr/bin/env node
// Тест интеграции с Fireflies API
// Запуск: node scripts/test-fireflies.js

// Resolve paths relative to backend node_modules
const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(`${backendDir}/node_modules/dotenv`).config({ path: path.join(__dirname, '../.env') });

const fireflies = require('../backend/src/fireflies');

async function main() {
  console.log('🔍 Проверка Fireflies API...\n');

  // Тест 1: Активные митинги
  console.log('1. Активные митинги:');
  try {
    const meetings = await fireflies.getActiveMeetings();
    if (meetings.length === 0) {
      console.log('   Нет активных митингов (норм, если нет текущего звонка)\n');
    } else {
      meetings.forEach((m) => {
        console.log(`   ✅ ${m.title} (id: ${m.id}, state: ${m.state})`);
      });
    }
  } catch (err) {
    console.log(`   ❌ Ошибка: ${err.message}\n`);
  }

  // Тест 2: Последние транскрипты
  console.log('2. Последние транскрипты:');
  try {
    const transcripts = await fireflies.getRecentTranscripts(3);
    if (transcripts.length === 0) {
      console.log('   Нет транскриптов');
    } else {
      transcripts.forEach((t) => {
        console.log(`   ✅ ${t.title} (id: ${t.id}, ${new Date(t.date).toLocaleDateString('ru')})`);
      });
      console.log(`\n   Для теста Realtime API используй ID: ${transcripts[0].id}`);
    }
  } catch (err) {
    console.log(`   ❌ Ошибка: ${err.message}`);
  }

  console.log('\n✅ Тест завершён');
  process.exit(0);
}

main().catch(console.error);
