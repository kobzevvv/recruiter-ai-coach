const { io } = require('socket.io-client');
const axios = require('axios');

const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;
const GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

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

async function getActiveMeetings() {
  const query = `
    query ActiveMeetings {
      active_meetings {
        id title organizer_email meeting_link start_time state
      }
    }
  `;
  const data = await gql(query);
  return data.active_meetings || [];
}

async function getTranscript(id) {
  const query = `
    query GetTranscript($id: String!) {
      transcript(id: $id) {
        id title date duration
        sentences { index text speaker_name start_time end_time }
        summary { keywords overview action_items }
      }
    }
  `;
  const data = await gql(query, { id });
  return data.transcript;
}

async function getRecentTranscripts(limit = 5) {
  const query = `
    query RecentTranscripts($limit: Int) {
      transcripts(limit: $limit, mine: true) {
        id title date duration
        speakers { name }
      }
    }
  `;
  const data = await gql(query, { limit });
  return data.transcripts || [];
}

// Polling-based realtime (fallback когда WebSocket API недоступен)
function connectRealtimePolling(transcriptId, onTranscription, onStatus, intervalMs = 5000) {
  console.log(`[Fireflies] Starting polling for transcript: ${transcriptId} (every ${intervalMs}ms)`);
  onStatus('listening');

  let lastSentenceIndex = -1;
  let running = true;

  const poll = async () => {
    if (!running) return;
    try {
      const data = await gql(`
        query T($id: String!) {
          transcript(id: $id) {
            sentences { index text speaker_name start_time end_time }
          }
        }
      `, { id: transcriptId });

      const sentences = data.transcript?.sentences || [];
      const newOnes = sentences.filter(s => s.index > lastSentenceIndex);

      for (const s of newOnes) {
        lastSentenceIndex = s.index;
        const segment = {
          chunkId: `${transcriptId}_${s.index}`,
          text: s.text?.trim(),
          speaker: s.speaker_name || 'Unknown',
          startTime: s.start_time,
          endTime: s.end_time,
          timestamp: new Date().toISOString(),
        };
        if (segment.text) {
          console.log(`[Fireflies] [${segment.speaker}]: ${segment.text}`);
          onTranscription(segment);
        }
      }
    } catch (err) {
      console.error('[Fireflies] Polling error:', err.message);
    }

    if (running) setTimeout(poll, intervalMs);
  };

  poll();

  return {
    disconnect: () => {
      running = false;
      console.log('[Fireflies] Polling stopped');
      onStatus('disconnected');
    },
  };
}

// WebSocket Realtime API (основной, если поддерживается планом)
function connectRealtimeWS(transcriptId, onTranscription, onStatus) {
  console.log(`[Fireflies] Connecting WebSocket realtime for: ${transcriptId}`);

  const socket = io('wss://api.fireflies.ai', {
    path: '/ws/realtime',
    transports: ['websocket'],
    auth: {
      token: `Bearer ${FIREFLIES_API_KEY}`,
      transcriptId,
    },
    timeout: 10000,
  });

  const seenChunks = new Map();
  let gotData = false;

  // Если за 15 секунд нет данных — падаем на polling
  const fallbackTimer = setTimeout(() => {
    if (!gotData) {
      console.log('[Fireflies] No realtime data in 15s, switching to polling...');
      socket.disconnect();
    }
  }, 15000);

  socket.on('connect', () => {
    console.log('[Fireflies] WS connected');
    onStatus('connected');
  });

  socket.on('auth.success', () => {
    console.log('[Fireflies] WS auth OK');
    onStatus('authenticated');
  });

  socket.on('auth.failed', () => {
    console.error('[Fireflies] WS auth failed');
    clearTimeout(fallbackTimer);
    socket.disconnect();
  });

  socket.on('connection.established', () => {
    console.log('[Fireflies] WS listening...');
    onStatus('listening');
  });

  socket.on('transcription.broadcast', (data) => {
    gotData = true;
    clearTimeout(fallbackTimer);
    const { chunk_id, text, speaker_name, start_time, end_time } = data;
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
    console.log('[Fireflies] WS disconnected:', reason);
    onStatus('disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('[Fireflies] WS connect error:', err.message);
    clearTimeout(fallbackTimer);
  });

  return { disconnect: () => { clearTimeout(fallbackTimer); socket.disconnect(); }, socket };
}

// Основная точка входа: сначала пробует WS, при неудаче — polling
function connectRealtime(transcriptId, onTranscription, onStatus) {
  let pollingConn = null;

  const wsConn = connectRealtimeWS(transcriptId, onTranscription, (status) => {
    onStatus(status);
    // Если WS отвалился — включаем polling
    if (status === 'disconnected' && !pollingConn) {
      console.log('[Fireflies] Falling back to polling');
      pollingConn = connectRealtimePolling(transcriptId, onTranscription, onStatus);
    }
  });

  return {
    disconnect: () => {
      wsConn.disconnect();
      pollingConn?.disconnect();
    },
  };
}

module.exports = {
  getActiveMeetings,
  getTranscript,
  getRecentTranscripts,
  connectRealtime,
  connectRealtimePolling,
};
