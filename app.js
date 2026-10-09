/* Smart Shuffle – Prototyp zum Testen der Spotify-Verbindung.
 * Reine Client-App (kein Server): Login per OAuth "Authorization Code + PKCE",
 * daher wird kein Client Secret benötigt und nichts Geheimes landet im Repo.
 */
'use strict';

const SCOPES = [
  'user-read-private',          // Profil + Premium-Status
  'user-library-read',          // gespeicherte Songs
  'user-read-playback-state',   // Geräte abfragen
  'user-modify-playback-state', // Wiedergabe starten
].join(' ');

const REDIRECT_URI = location.origin + location.pathname;
const API = 'https://api.spotify.com/v1';
const $ = (id) => document.getElementById(id);

/* ---------- Speicher (robust, falls localStorage blockiert ist) ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------- Status & Protokoll ---------- */
function log(msg) {
  const t = new Date().toLocaleTimeString('de-DE');
  $('log').textContent = `[${t}] ${msg}\n` + $('log').textContent;
}
function check(name, state, detail = '') {
  const li = document.querySelector(`[data-check="${name}"]`);
  if (!li) return;
  li.className = state; // ok | fail | wait | ''
  const label = li.dataset.label || (li.dataset.label = li.textContent);
  li.innerHTML = label + (detail ? `<small>${escapeHtml(detail)}</small>` : '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- PKCE-Login ---------- */
function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
async function sha256base64url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function login() {
  const clientId = $('clientId').value.trim();
  if (!clientId) { alert('Bitte zuerst die Client ID eintragen.'); return; }
  store.set('clientId', clientId);
  const verifier = randomString(64);
  const state = randomString(16);
  store.set('pkce', { verifier, state });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: await sha256base64url(verifier),
    scope: SCOPES,
    state,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + params;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  const token = {
    access: data.access_token,
    refresh: data.refresh_token || store.get('token')?.refresh,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  store.set('token', token);
  return token;
}

async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return;
  history.replaceState(null, '', REDIRECT_URI); // Code aus der Adresszeile entfernen
  if (q.has('error')) { check('auth', 'fail', 'Spotify meldet: ' + q.get('error')); return; }
  const pkce = store.get('pkce');
  if (!pkce || pkce.state !== q.get('state')) { check('auth', 'fail', 'Ungültiger Login-Status, bitte neu anmelden.'); return; }
  check('auth', 'wait');
  try {
    await tokenRequest({
      grant_type: 'authorization_code',
      code: q.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: store.get('clientId'),
      code_verifier: pkce.verifier,
    });
    store.del('pkce');
    log('Login erfolgreich.');
  } catch (e) {
    check('auth', 'fail', e.message);
    log('Token-Fehler: ' + e.message);
  }
}

async function getAccessToken() {
  let t = store.get('token');
  if (!t) throw new Error('Nicht angemeldet');
  if (Date.now() > t.expires) {
    log('Token abgelaufen, erneuere …');
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: store.get('clientId') });
  }
  return t.access;
}

function logout() {
  store.del('token');
  location.reload();
}

/* ---------- Spotify-API ---------- */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    log(`Rate-Limit erreicht, warte ${wait}s …`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api(path, opts);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.reason = data?.error?.reason;
    throw err;
  }
  return data;
}

/* ---------- Zustand ---------- */
let tracks = [];        // die letzten 100 gespeicherten Songs
let genres = {};        // artistId -> [genres]
let queue = [];         // aktuelle Shuffle-Reihenfolge

async function loadProfile() {
  check('profile', 'wait');
  try {
    const me = await api('/me');
    const premium = me.product === 'premium';
    check('profile', premium ? 'ok' : 'fail',
      `${me.display_name || me.id} · ${premium ? 'Premium' : 'kein Premium – Wiedergabe-Steuerung nicht möglich'}`);
    check('auth', 'ok');
    $('loadBtn').disabled = false;
    $('logoutBtn').hidden = false;
    $('loginBtn').textContent = 'Erneut anmelden';
  } catch (e) {
    check('profile', 'fail', e.message);
    if (e.status === 403) log('403: Ist dein Spotify-Konto im Dashboard unter „User Management“ eingetragen?');
  }
}

async function loadTracks() {
  check('tracks', 'wait');
  $('loadBtn').disabled = true;
  try {
    tracks = [];
    for (let offset = 0; offset < 100; offset += 50) {
      const page = await api(`/me/tracks?limit=50&offset=${offset}`);
      for (const it of page.items) {
        const t = it.track;
        if (!t || !t.uri) continue;
        tracks.push({
          uri: t.uri,
          name: t.name,
          album: t.album?.name || '',
          artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
          addedAt: it.added_at,
        });
      }
      if (!page.next) break;
    }
    check('tracks', tracks.length ? 'ok' : 'fail', `${tracks.length} Songs geladen`);
    log(`${tracks.length} gespeicherte Songs geladen.`);
    $('genreBtn').disabled = !tracks.length;
    $('shuffleBtn').disabled = !tracks.length;
    makeShuffle();
  } catch (e) {
    check('tracks', 'fail', e.message);
  } finally {
    $('loadBtn').disabled = false;
  }
}

/* Genres hängen an den Interpreten. Batch-Abfragen hat Spotify 2026 entfernt,
 * daher einzeln und leicht gedrosselt; Ergebnisse werden zwischengespeichert. */
async function loadGenres() {
  check('genres', 'wait');
  $('genreBtn').disabled = true;
  genres = store.get('genreCache') || {};
  const ids = [...new Set(tracks.flatMap((t) => t.artists.map((a) => a.id)).filter(Boolean))];
  const missing = ids.filter((id) => !(id in genres));
  let done = 0, failed = 0;
  for (const id of missing) {
    try {
      const a = await api('/artists/' + id);
      genres[id] = a.genres || [];
    } catch (e) {
      failed++;
      if (failed === 1) log('Genre-Fehler: ' + e.message);
    }
    done++;
    check('genres', 'wait', `${done}/${missing.length} Interpreten …`);
    await new Promise((r) => setTimeout(r, 120));
  }
  store.set('genreCache', genres);
  const withGenre = ids.filter((id) => genres[id]?.length).length;
  check('genres', failed && !withGenre ? 'fail' : 'ok', `${withGenre} von ${ids.length} Interpreten mit Genre-Angaben`);
  $('genreBtn').disabled = false;
}

/* ---------- Spracheingabe ---------- */
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    check('speech', 'fail', 'Browser unterstützt keine Spracheingabe – auf dem iPhone Safari nutzen.');
    $('micBtn').disabled = true;
    return;
  }
  check('speech', '', 'verfügbar – zum Testen Mikrofon antippen');
  const rec = new SR();
  rec.lang = 'de-DE';
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false;
  rec.onstart = () => { listening = true; $('micBtn').classList.add('listening'); };
  rec.onend = () => {
    listening = false;
    $('micBtn').classList.remove('listening');
    if ($('query').value.trim() && tracks.length) makeShuffle();
  };
  rec.onresult = (ev) => {
    const text = Array.from(ev.results).map((r) => r[0].transcript).join(' ');
    $('query').value = text;
    showParsed();
    if (ev.results[ev.results.length - 1].isFinal) {
      check('speech', 'ok', `erkannt: „${text}“`);
      log('Sprache erkannt: ' + text);
    }
  };
  rec.onerror = (ev) => {
    const msg = ev.error === 'not-allowed' ? 'Mikrofon-Zugriff verweigert' : ev.error;
    check('speech', 'fail', msg);
  };
  $('micBtn').addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); } catch (e) { log('Sprachstart: ' + e.message); }
  });
}

/* ---------- Kriterien verstehen (regelbasiert, KI folgt später) ---------- */
const SYNONYMS = {
  rap: ['rap', 'hip hop', 'hip-hop'],
  'hip hop': ['hip hop', 'hip-hop', 'rap'],
  hiphop: ['hip hop', 'hip-hop', 'rap'],
  elektro: ['electro', 'electronic', 'house', 'techno', 'edm'],
  elektronisch: ['electro', 'electronic', 'house', 'techno', 'edm'],
  klassik: ['classical', 'klassik'],
  schlager: ['schlager'],
  'deutschrap': ['german hip hop', 'deutschrap', 'rap'],
  'deutsch rap': ['german hip hop', 'deutschrap', 'rap'],
  metal: ['metal'],
  rock: ['rock'],
  pop: ['pop'],
  indie: ['indie'],
  jazz: ['jazz'],
};
const FILLER = /\b(songs?|lieder?|titel|tracks?|musik|bitte|spiel(e|t)?|mir|mal|nur|von|mit|ohne|keine[nm]?|kein|nicht|außer|ausser|die|der|das|den|dem|etwas|was|shuffle|shuffel|aus|meinen?|gespeicherten|letzten|\d+)\b/g;

function parseQuery(text) {
  const result = { include: [], exclude: [], count: 100 };
  const lower = text.toLowerCase();
  const n = lower.match(/letzten\s+(\d+)/);
  if (n) result.count = Math.min(100, Math.max(1, Number(n[1])));
  const clauses = lower.split(/,|;|\bund\b|\baber\b|\bsowie\b/);
  for (const clause of clauses) {
    const negative = /\b(ohne|kein|keine|keinen|keinem|nicht|außer|ausser)\b/.test(clause);
    const term = clause.replace(FILLER, ' ').replace(/[„“"'.!?]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!term) continue;
    (negative ? result.exclude : result.include).push(term);
  }
  return result;
}

function termMatches(track, term) {
  const variants = SYNONYMS[term] || [term];
  const hay = [
    track.name, track.album,
    ...track.artists.map((a) => a.name),
    ...track.artists.flatMap((a) => genres[a.id] || []),
  ].join(' | ').toLowerCase();
  return variants.some((v) => hay.includes(v));
}

function showParsed() {
  const q = parseQuery($('query').value);
  const parts = [];
  if (q.count !== 100) parts.push(`letzte ${q.count}`);
  if (q.include.length) parts.push('nur: ' + q.include.join(', '));
  if (q.exclude.length) parts.push('ohne: ' + q.exclude.join(', '));
  $('parsed').textContent = parts.length ? 'Verstanden → ' + parts.join(' · ') : '';
}

/* ---------- Smart Shuffle ---------- */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Zufällig mischen, dann so umsortieren, dass derselbe Interpret
 * möglichst nicht zweimal hintereinander kommt. */
function spreadArtists(list) {
  const pool = shuffleArray(list);
  const out = [];
  while (pool.length) {
    const last = out[out.length - 1]?.artists[0]?.id;
    let idx = pool.findIndex((t) => t.artists[0]?.id !== last);
    if (idx === -1) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function makeShuffle() {
  const q = parseQuery($('query').value);
  showParsed();
  let pool = tracks.slice(0, q.count);
  if (q.include.length) pool = pool.filter((t) => q.include.some((term) => termMatches(t, term)));
  if (q.exclude.length) pool = pool.filter((t) => !q.exclude.some((term) => termMatches(t, term)));
  queue = spreadArtists(pool);
  renderQueue();
  $('playBtn').disabled = !queue.length;
  if (!queue.length && tracks.length) {
    log('Keine Treffer. Tipp: Für Genre-Filter zuerst „Genres laden“ antippen.');
  }
}

function renderQueue() {
  $('count').textContent = queue.length ? `(${queue.length})` : '';
  $('list').innerHTML = queue
    .map((t) => `<li>${escapeHtml(t.name)}<small>${escapeHtml(t.artists.map((a) => a.name).join(', '))}</small></li>`)
    .join('');
}

/* ---------- Wiedergabe über Spotify Connect ---------- */
async function play() {
  check('devices', 'wait');
  try {
    const { devices } = await api('/me/player/devices');
    if (!devices.length) {
      check('devices', 'fail', 'Kein Gerät gefunden – Spotify-App öffnen und kurz einen Song starten.');
      return;
    }
    const device = devices.find((d) => d.is_active) || devices.find((d) => d.type === 'Smartphone') || devices[0];
    check('devices', 'ok', `${device.name} (${device.type})`);
    check('play', 'wait');
    await api(`/me/player/shuffle?state=false&device_id=${encodeURIComponent(device.id)}`, { method: 'PUT' }).catch(() => {});
    await api(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: queue.map((t) => t.uri) }),
    });
    check('play', 'ok', `${queue.length} Songs, beginnt mit „${queue[0].name}“`);
    log('Wiedergabe gestartet auf ' + device.name);
  } catch (e) {
    const hint = e.status === 403 ? ' (Premium nötig?)' : e.status === 404 ? ' (Gerät nicht aktiv – Spotify öffnen)' : '';
    check('play', 'fail', e.message + hint);
  }
}

/* ---------- Start ---------- */
async function init() {
  $('redirectUri').textContent = REDIRECT_URI;
  $('redirectUri').addEventListener('click', () => {
    navigator.clipboard?.writeText(REDIRECT_URI).then(() => log('Redirect URI kopiert.'));
  });
  $('clientId').value = store.get('clientId') || '';
  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', logout);
  $('loadBtn').addEventListener('click', loadTracks);
  $('genreBtn').addEventListener('click', loadGenres);
  $('shuffleBtn').addEventListener('click', makeShuffle);
  $('playBtn').addEventListener('click', play);
  $('query').addEventListener('input', showParsed);
  $('query').addEventListener('keydown', (e) => { if (e.key === 'Enter' && tracks.length) makeShuffle(); });
  setupSpeech();

  if (location.protocol !== 'https:' && !['127.0.0.1', '[::1]'].includes(location.hostname)) {
    log('Hinweis: Spotify akzeptiert nur HTTPS oder 127.0.0.1 als Redirect URI.');
  }
  await handleRedirect();
  if (store.get('token')) await loadProfile();
}

init();
