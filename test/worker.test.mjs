// Testet den Worker ohne Netz: Spotify und Claude werden durch Attrappen ersetzt.
import worker from '../worker/src/index.js';
let lastClaudeBody = null;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('api.spotify.com/v1/me')) {
    const ok = opts.headers.Authorization === 'Bearer gut';
    return new Response(JSON.stringify(ok ? { id: 'jannis' } : { error: {} }), { status: ok ? 200 : 401 });
  }
  if (String(url).includes('api.anthropic.com')) {
    lastClaudeBody = JSON.parse(opts.body);
    if (lastClaudeBody.tool_choice.name === 'set_artist_genres') {
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'set_artist_genres', input: {
        artists: [{ i: 1, g: ['German Indie', 'indie', 'rock'] }, { i: 2, g: ['hip hop'] }, { i: 99, g: ['quatsch'] }] } }],
        usage: { input_tokens: 500, output_tokens: 80 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'set_shuffle_filter', input: {
      include_artists: ['kraftklub', 'Erfundene Band'], exclude_artists: [], include_genres: ['german indie', 'quatsch'],
      exclude_genres: ['german hip hop'], year_from: 1999, year_to: 1990, count: 50, summary: 'Kraftklub und Indie, ohne Rap' } }],
      usage: { input_tokens: 900, output_tokens: 60 } }), { status: 200 });
  }
  throw new Error('unerwartet: ' + url);
};
const env = { ANTHROPIC_API_KEY: 'sk', ALLOWED_USERS: 'jannis, freund1' };
const O = 'https://servusgruss.github.io';
const req = (auth, origin = O, body = { text: 'die letzten 50 von kraft club und indie ohne rap', artists: ['Kraftklub', 'Cro'], genres: ['german indie', 'german hip hop'] }) =>
  new Request('https://w.dev/interpret', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const show = async (name, p) => { const r = await p; console.log(name.padEnd(28), r.status, (await r.text()).slice(0, 220)); };
await show('OK', worker.fetch(req('gut'), env));
console.log('  Modell/Thinking/Tool:', lastClaudeBody.model, JSON.stringify(lastClaudeBody.thinking), lastClaudeBody.tool_choice.name);
await show('Genres zuordnen', worker.fetch(new Request('https://w.dev/tag-artists', { method: 'POST', headers: { Origin: O, Authorization: 'Bearer gut' }, body: JSON.stringify({ artists: ['Kraftklub', 'Cro'] }) }), env));
await show('Falscher Login', worker.fetch(req('schlecht'), env));
await show('Nicht freigegeben', worker.fetch(req('gut'), { ...env, ALLOWED_USERS: 'freund1' }));
await show('Fremde Webseite', worker.fetch(req('gut', 'https://boese.example'), env));
await show('Kein Schlüssel', worker.fetch(req('gut'), { ALLOWED_USERS: 'jannis' }));
await show('Preflight', worker.fetch(new Request('https://w.dev/interpret', { method: 'OPTIONS', headers: { Origin: O } }), env));
await show('Health', worker.fetch(new Request('https://w.dev/health', { headers: { Origin: O } }), env));
// Tageslimit mit Attrappen-KV
const kv = new Map(); const USAGE = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) };
const lim = { ...env, USAGE, DAILY_LIMIT: '2' };
for (let i = 1; i <= 3; i++) await show('Limit Anfrage ' + i, worker.fetch(req('gut'), lim));
