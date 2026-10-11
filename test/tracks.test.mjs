// Testet /tag-tracks und die neuen Filterfelder ohne Netz.
import worker from '../worker/src/index.js';
let lastfmCalls = 0, claudeBody = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.spotify.com/v1/me')) return new Response(JSON.stringify({ id: 'jannis' }), { status: 200 });
  if (u.includes('audioscrobbler')) {
    lastfmCalls++;
    const t = new URL(u).searchParams.get('track');
    if (t === 'Unbekannt') return new Response(JSON.stringify({ error: 6, message: 'Track not found' }), { status: 200 });
    return new Response(JSON.stringify({ toptags: { tag: [{ name: 'Ballad', count: 100 }, { name: 'German', count: 60 }, { name: 'seen live', count: 3 }] } }), { status: 200 });
  }
  if (u.includes('api.anthropic.com')) {
    claudeBody = JSON.parse(opts.body);
    if (claudeBody.tool_choice.name === 'set_track_features') {
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'set_track_features', input: { songs: [
        { i: 1, g: ['Metal', 'neue deutsche härte'], m: ['ruhig', 'melancholisch', 'quatsch'], e: 2, l: 'DE', y: 2004 },
        { i: 2, g: ['pop'], m: ['tanzbar'], e: 9, l: 'english', y: 2030 },
        { i: 99, g: ['x'], m: [], e: 3, l: 'de', y: null },
      ] } }], usage: { input_tokens: 800, output_tokens: 120 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'set_shuffle_filter', input: {
      include_artists: [], exclude_artists: [], include_genres: ['rock'], exclude_genres: [], title_keywords: [],
      include_moods: ['ruhig', 'gechillt'], exclude_moods: [], energy_min: 4, energy_max: 2, languages: ['de', 'deutsch'],
      year_from: null, year_to: null, count: null, summary: 'ruhiger Rock' } }] }), { status: 200 });
  }
  throw new Error('unerwartet ' + u);
};
const O = 'https://servusgruss.github.io';
const post = (path, env, body) => worker.fetch(new Request('https://w.dev' + path, { method: 'POST', headers: { Origin: O, Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then((r) => r.json());
const base = { ANTHROPIC_API_KEY: 'k', ALLOWED_USERS: 'jannis', LASTFM_API_KEY: 'lf' };
const tracks = [{ a: 'Rammstein', t: 'Ohne dich', y: 2011 }, { a: 'Band', t: 'Unbekannt', y: 2020 }, { a: 'X', t: 'Y' }];

let r = await post('/tag-tracks', base, { tracks });
console.log('Merkmale:', JSON.stringify(r.tags));
console.log('Last.fm-Abfragen:', lastfmCalls, '| mit Schlagworten:', r.lastfmHits);
console.log('An Claude:', claudeBody.messages[0].content.split('\n')[0]);
const many = Array.from({ length: 120 }, (_, i) => ({ a: 'A', t: 'T' + i }));
lastfmCalls = 0; await post('/tag-tracks', base, { tracks: many });
console.log('120 Songs mit Last.fm → verarbeitet:', claudeBody.messages[0].content.split('\n').length, '| Last.fm-Abfragen:', lastfmCalls);
lastfmCalls = 0; await post('/tag-tracks', { ...base, LASTFM_API_KEY: '' }, { tracks: many });
console.log('120 Songs ohne Last.fm → verarbeitet:', claudeBody.messages[0].content.split('\n').length, '| Last.fm-Abfragen:', lastfmCalls);

r = await post('/interpret', base, { text: 'ruhiger deutscher Rock', artists: ['Rammstein'], genres: ['rock', 'metal'], songTags: true });
console.log('Wunsch mit Song-Merkmalen:', JSON.stringify(r.filter));
console.log('  strenge Anleitung:', claudeBody.system[0].text.includes('KEINE Interpreten'));
r = await post('/interpret', base, { text: 'ruhiger Rock', artists: ['Rammstein'], genres: ['rock'] });
console.log('Wunsch ohne Song-Merkmale: moods', JSON.stringify(r.filter.include_moods), 'energie', r.filter.energy_min, '| alte Anleitung:', claudeBody.system[0].text.includes('großzügig'));
