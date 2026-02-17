const { io } = require('socket.io-client');
const axios = require('axios');

const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;
const GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

// GraphQL helper
async function gql(query, variables = {}) {
  const res = await axios.post(
    GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${FIREFLIES_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (res.data.errors) {
    throw new Error(res.data.errors.map((e) => e.message).join(', '));
  }
  return res.data.data;
}

// Получить список активных митингов
async function getActiveMeetings() {
  const query = `
    query ActiveMeetings {
      active_meetings {
        id
        title
        organizer_email
        meeting_link
        start_time
        state
      }
    }
  `;
  const data = await gql(query);
  return data.active_meetings || [];
}

// Получить транскрипт по ID (после звонка или для проверки)
async function getTranscript(id) {
  const query = `
    query GetTranscript($id: String!) {
      transcript(id: $id) {
        id
        title
        date
        duration
        sentences {
          index
          text
          speaker_name
          start_time
          end_time
        }
        summary {
          keywords
          overview
          action_items
        }
      }
    }
  `;
  const data = await gql(query, { id });
  return data.transcript;
}

// Получить последние транскрипты
async function getRecentTranscripts(limit = 5) {
  const query = `
    query RecentTranscripts($limit: Int) {
      transcripts(limit: $limit, mine: true) {
        id
        title
        date
        duration
        speakers {
          name
        }
      }
    }
  `;
  const data = await gql(query, { limit });
  return data.transcripts || [];
}

// Подключиться к Realtime WebSocket для живой транскрипции
function connectRealtime(transcriptId, onTranscription, onStatus) {
  console.log(`[Fireflies] Connecting to realtime for transcript: ${transcriptId}`);

  const socket = io('wss://api.fireflies.ai', {
    path: '/ws/realtime',
    transports: ['websocket'],
    auth: {
      token: `Bearer ${FIREFLIES_API_KEY}`,
      transcriptId,
    },
  });

  const seenChunks = new Map(); // chunk_id → last text (для дедупликации)

  socket.on('connect', () => {
    console.log('[Fireflies] Socket connected');
    if (onStatus) onStatus('connected');
  });

  socket.on('auth.success', () => {
    console.log('[Fireflies] Auth successful');
    if (onStatus) onStatus('authenticated');
  });

  socket.on('auth.failed', (data) => {
    console.error('[Fireflies] Auth failed:', data);
    if (onStatus) onStatus('auth_failed');
  });

  socket.on('connection.established', () => {
    console.log('[Fireflies] Connection established, listening for transcription...');
    if (onStatus) onStatus('listening');
  });

  socket.on('connection.error', (data) => {
    console.error('[Fireflies] Connection error:', data);
    if (onStatus) onStatus('error');
  });

  socket.on('transcription.broadcast', (data) => {
    const { chunk_id, text, speaker_name, start_time, end_time } = data;

    // Дедупликация: если тот же chunk с тем же текстом — пропускаем
    if (seenChunks.get(chunk_id) === text) return;
    seenChunks.set(chunk_id, text);

    const segment = {
      chunkId: chunk_id,
      text: text?.trim(),
      speaker: speaker_name || 'Unknown',
      startTime: start_time,
      endTime: end_time,
      timestamp: new Date().toISOString(),
    };

    if (segment.text) {
      console.log(`[Fireflies] [${segment.speaker}]: ${segment.text}`);
      onTranscription(segment);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[Fireflies] Disconnected:', reason);
    if (onStatus) onStatus('disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('[Fireflies] Connect error:', err.message);
    if (onStatus) onStatus('error');
  });

  return {
    disconnect: () => socket.disconnect(),
    socket,
  };
}

module.exports = {
  getActiveMeetings,
  getTranscript,
  getRecentTranscripts,
  connectRealtime,
};
