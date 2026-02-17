const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `Ты — AI-ассистент для рекрутера во время технического собеседования.
Ты получаешь транскрипцию разговора в реальном времени и генерируешь краткие подсказки.

Твои подсказки должны быть:
- Краткими (1-3 предложения максимум)
- Конкретными и actionable
- На русском языке
- Профессиональными

Типы подсказок, которые ты можешь генерировать:

🔍 УТОЧНИ — когда кандидат говорит что-то расплывчато
❓ ВОПРОС — конкретный follow-up вопрос ("ты используешь Vue или React?", "какую версию используешь?")
🚩 ФЛАГ — противоречие или красный флаг в ответе
✅ ПОЗИТИВ — отличный ответ, стоит отметить
⏭ ДАЛЕЕ — предложение перейти к следующей теме
💡 ИНСАЙТ — интересный момент для углубления

Отвечай ТОЛЬКО если есть что-то важное для рекрутера. Если ничего примечательного — ответь пустой строкой.

Формат ответа:
[ТYPE_EMOJI] Текст подсказки

Пример:
❓ Уточни, какой фреймворк для стейт-менеджмента он использовал — Redux или Zustand?`;

// Хранилище контекста разговора по сессиям
const sessionContexts = new Map();

function addToContext(sessionId, segment) {
  if (!sessionContexts.has(sessionId)) {
    sessionContexts.set(sessionId, {
      segments: [],
      prepContext: null,
      lastHintAt: 0,
      hintCount: 0,
    });
  }
  const ctx = sessionContexts.get(sessionId);
  ctx.segments.push(segment);
  if (ctx.segments.length > 50) {
    ctx.segments = ctx.segments.slice(-50);
  }
}

function setPrepContext(sessionId, prepContext) {
  if (!sessionContexts.has(sessionId)) {
    sessionContexts.set(sessionId, { segments: [], prepContext: null, lastHintAt: 0, hintCount: 0 });
  }
  sessionContexts.get(sessionId).prepContext = prepContext;
}

async function generateHint(sessionId, newSegment, { noThrottle = false } = {}) {
  const ctx = sessionContexts.get(sessionId);
  if (!ctx) return null;

  // Throttling: не чаще раз в 20 секунд (отключается в тест-режиме)
  const now = Date.now();
  if (!noThrottle && now - ctx.lastHintAt < 20000) return null;

  const recentSegments = ctx.segments.slice(-10);
  const recentText = recentSegments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  if (recentText.length < 30) return null;

  const prepSection = ctx.prepContext
    ? `\n\nКонтекст подготовки к интервью:\n${ctx.prepContext}\n`
    : '';

  const userMessage = `${prepSection}
Транскрипция последних реплик:
${recentText}

Новая реплика: ${newSegment.speaker}: ${newSegment.text}

Нужна ли рекрутеру подсказка прямо сейчас? Если да — напиши её. Если нет — пустую строку.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const hint = response.choices[0]?.message?.content?.trim();
    if (hint && hint.length > 2) {
      ctx.lastHintAt = now;
      ctx.hintCount++;
      return hint;
    }
    return null;
  } catch (err) {
    console.error('[OpenAI] Error generating hint:', err.message);
    return null;
  }
}

async function generatePrepKit(candidateCV, jobDescription, role) {
  const prompt = `Подготовь рекрутера к техническому интервью на позицию: ${role}

CV кандидата:
${candidateCV}

Описание вакансии:
${jobDescription}

Подготовь краткий prep kit для рекрутера (займёт 5 минут на изучение):

1. **Технический стек кандидата** — что использовал, на каком уровне
2. **Ключевые термины** — 8-10 терминов которые прозвучат в разговоре, с кратким объяснением
3. **Умные вопросы** — 6-8 вопросов типа "ты используешь A или B?", которые покажут что рекрутер разбирается
4. **На что обратить внимание** — красные флаги исходя из CV, пробелы в опыте
5. **Позитивные индикаторы** — что говорит о сильном кандидате
6. **Вопросы для закрытия** — как завершить интервью

Отвечай кратко, по делу. Рекрутер — не технарь, но должен казаться компетентным.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content;
}

function clearSession(sessionId) {
  sessionContexts.delete(sessionId);
}

module.exports = {
  addToContext,
  setPrepContext,
  generateHint,
  generatePrepKit,
  clearSession,
};
