// Testet /discover ohne Netz: Spotify, Last.fm und Claude sind Attrappen.
import worker from '../worker/src/index.js';
let lastfmCalls = 0, lastfmMode = 'ok', claudeWant = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.spotify.com/v1/me')) return new Response(JSON.stringify({ id: 'jannis' }), { status: 200 });
  if (u.includes('audioscrobbler')) {
    lastfmCalls++;
    if (lastfmMode === 'error') return new Response(JSON.stringify({ error: 29, message: 'Rate limit exceeded' }), { status: 200 });
    const p = new URL(u).searchParams;
    const base = p.get('artist');
    return new Response(JSON.stringify({ similartracks: { track: [
      { name: 'Similar A', match: '0.9', artist: { name: 'Band X' } },
      { name: 'Similar B', match: '0.8', artist: { name: 'Band X' } },
      { name: 'Similar C', match: '0.7', artist: { name: 'Band X' } },      // 3. von Band X → raus
      { name: p.get('track'), match: '1', artist: { name: base } },          // Startsong selbst → raus
      { name: 'Deep Cut ' + base, match: '0.6', artist: { name: base + ' Jr' } },
    ] } }), { status: 200 });
  }
  if (u.includes('api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    claudeWant = body.messages[0].content.match(/Anzahl Vorschläge: (\d+)/)[1];
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'suggest_songs', input: { songs: [
      { artist: 'Neue Band', title: 'Hit (Remastered 2011)' }, { artist: 'Kraftklub', title: 'Songs für Liam' }, { artist: 'Indie Duo', title: 'Morgenrot' },
    ] } }], usage: { input_tokens: 700, output_tokens: 90 } }), { status: 200 });
  }
  throw new Error('unerwartet ' + u);
};
const O = 'https://servusgruss.github.io';
const call = (env, body) => worker.fetch(new Request('https://w.dev/discover', { method: 'POST', headers: { Origin: O, Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then((r) => r.json());
const base = { ANTHROPIC_API_KEY: 'k', ALLOWED_USERS: 'jannis', LASTFM_API_KEY: 'lf' };
const body = { count: 10, seeds: [{ artist: 'Kraftklub', title: 'Songs für Liam' }, { artist: 'Cro', title: 'Easy' }], artists: ['Kraftklub', 'Cro'] };
const show = (name, r) => console.log(name.padEnd(26), `Last.fm ${r.lastfm.length} (${r.lastfm.map((x) => x.title).join(', ')}) | KI ${r.ki.length} | KI gefragt: ${claudeWant} | Hinweise: ${r.notes.join(' / ') || '–'}`);
claudeWant = null; show('50/50', await call(base, { ...body, kiShare: 50 }));
claudeWant = null; show('nur Last.fm (KI aus)', await call(base, { ...body, kiShare: 0 }));
lastfmCalls = 0; claudeWant = null; show('nur KI (Last.fm aus)', await call(base, { ...body, kiShare: 100 })); console.log('  Last.fm-Abrufe bei „nur KI“:', lastfmCalls);
lastfmMode = 'error'; claudeWant = null; show('Last.fm bremst, 50/50', await call(base, { ...body, kiShare: 50 }));
claudeWant = null; show('Last.fm bremst, KI aus', await call(base, { ...body, kiShare: 0 }));
lastfmMode = 'ok'; claudeWant = null; show('kein Last.fm-Schlüssel', await call({ ...base, LASTFM_API_KEY: '' }, { ...body, kiShare: 30 }));
