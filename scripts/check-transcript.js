const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(`${backendDir}/node_modules/dotenv`).config({ path: path.join(__dirname, '../.env') });
const axios = require(`${backendDir}/node_modules/axios`);

const TRANSCRIPT_ID = process.argv[2] || '01KHPPR58BBPEV6WYVS7WDGKTQ';

axios.post('https://api.fireflies.ai/graphql', {
  query: `query T($id: String!) {
    transcript(id: $id) {
      id title duration
      sentences { text speaker_name start_time }
    }
  }`,
  variables: { id: TRANSCRIPT_ID }
}, {
  headers: { Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}` }
}).then(r => {
  if (r.data.errors) { console.log('GraphQL errors:', JSON.stringify(r.data.errors, null, 2)); return; }
  const t = r.data.data?.transcript;
  if (!t) { console.log('No transcript found'); return; }
  console.log(`Title: ${t.title} | Duration: ${t.duration}s | Sentences: ${t.sentences?.length || 0}`);
  if (t.sentences?.length > 0) {
    console.log('\nLast 5 sentences:');
    t.sentences.slice(-5).forEach(s => console.log(`  [${s.speaker_name}] ${s.text}`));
  } else {
    console.log('No sentences yet - Fireflies may still be processing');
  }
}).catch(e => console.error('Error:', e.response?.data || e.message));
