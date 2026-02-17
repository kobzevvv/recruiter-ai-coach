#!/bin/bash
# Recruiter AI Coach — Setup script
# Запуск: bash scripts/setup.sh

echo "🎯 Recruiter AI Coach — Setup"
echo "================================"
echo ""

# Проверяем .env
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✅ Создан .env из .env.example"
else
  echo "ℹ️  .env уже существует"
fi

echo ""
echo "📋 Что нужно заполнить в .env:"
echo ""

# Проверяем ключи
source .env 2>/dev/null

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ ANTHROPIC_API_KEY — нужно добавить"
  echo "   → https://console.anthropic.com/ → API Keys"
else
  echo "✅ ANTHROPIC_API_KEY — заполнен"
fi

if [ -z "$FIREFLIES_API_KEY" ]; then
  echo "❌ FIREFLIES_API_KEY — нужно добавить"
  echo "   → https://app.fireflies.ai/settings#DeveloperSettings"
else
  echo "✅ FIREFLIES_API_KEY — заполнен (${FIREFLIES_API_KEY:0:8}...)"
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "⚠️  TELEGRAM_BOT_TOKEN — опционально (MVP доставка подсказок)"
  echo "   → Напиши @BotFather в Telegram → /newbot"
else
  echo "✅ TELEGRAM_BOT_TOKEN — заполнен"
fi

echo ""
echo "📦 Установка зависимостей..."
cd backend && npm install --silent && cd ..
echo "✅ Зависимости установлены"

echo ""
echo "🧪 Тест Fireflies API..."
node scripts/test-fireflies.js

echo ""
echo "🚀 Запуск:"
echo "   cd backend && npm start"
echo ""
echo "   Или тест всего:"
echo "   curl http://localhost:3000/health"
