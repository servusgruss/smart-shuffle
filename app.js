/* Smart Shuffle – Web-App für einen intelligenten Spotify-Shuffle.
 * Reine Client-App: Login per OAuth "Authorization Code + PKCE" (kein Client Secret).
 * Bibliothek, Genres, Einstellungen und Login werden auf dem Gerät gespeichert,
 * damit beim nächsten Öffnen nichts neu eingegeben oder komplett neu geladen werden muss.
 */
'use strict';

const SCOPES = [
  'user-read-private',          // Profil + Premium-Status
  'user-library-read',          // Lieblingssongs
  'user-read-playback-state',   // Geräte abfragen
  'user-modify-playback-state', // Wiedergabe starten
  'playlist-read-private',      // eigene Shuffle-Playlist prüfen
  'playlist-modify-private',    // Shuffle-Reihenfolge in eigene private Playlist schreiben
];
const REDIRECT_URI = location.origin + location.pathname;
const API = 'https://api.spotify.com/v1';
const PLAYLIST_NAME = 'Smart Shuffle';
const THEMES = [
  { id: 'gruen', name: 'Grün · Spotify-Stil' },
  { id: 'weiss', name: 'Weiß · minimal' },
  { id: 'schwarz', name: 'Schwarz · minimal' },
  { id: 'nebel', name: 'Nebel · modern' },
  { id: 'vinyl', name: 'Vinyl · warm' },
];
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Gerätespeicher ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('ss:' + k)); } catch { return null; } },
  set(k, v) {
    try { localStorage.setItem('ss:' + k, JSON.stringify(v)); return true; }
    catch (e) { log('Speichern fehlgeschlagen (' + k + '): ' + e.message); return false; }
  },
  del(k) { try { localStorage.removeItem('ss:' + k); } catch {} },
};
const settings = Object.assign({ theme: 'gruen', count: '100', source: 'liked', query: '' }, store.get('settings') || {});
const saveSettings = () => store.set('settings', settings);

/* ---------- Rückmeldungen ---------- */
function log(msg) {
  const t = new Date().toLocaleTimeString('de-DE');
  $('log').textContent = `[${t}] ${msg}\n` + $('log').textContent.slice(0, 6000);
}
let toastTimer;
function toast(msg, bad = false) {
  $('toast').textContent = msg;
  $('toast').classList.toggle('bad', bad);
  clearTimeout(toastTimer);
  if (msg && !bad) toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 5000);
}
function check(name, state, detail = '') {
  const li = document.querySelector(`[data-check="${name}"]`);
  if (!li) return;
  li.className = state;
  const label = li.dataset.label || (li.dataset.label = li.textContent);
  li.innerHTML = escapeHtml(label) + (detail ? `<small>${escapeHtml(detail)}</small>` : '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Design ---------- */
function applyTheme(id) {
  settings.theme = THEMES.some((t) => t.id === id) ? id : 'gruen';
  document.documentElement.dataset.theme = settings.theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg || '#121212');
  document.querySelectorAll('.theme-tile').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)));
  saveSettings();
}
function renderThemePicker() {
  $('themes').innerHTML = THEMES.map((t) => `
    <button class="theme-tile" data-theme="${t.id}" aria-pressed="false">
      <span class="demo">Aa<span class="dot"></span></span>
      <span class="name">${escapeHtml(t.name)}</span>
    </button>`).join('');
  $('themes').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-tile');
    if (b) applyTheme(b.dataset.theme);
  });
}

/* ---------- Login (PKCE) ---------- */
function clientId() {
  return (window.SMART_SHUFFLE_CONFIG && window.SMART_SHUFFLE_CONFIG.clientId) || store.get('clientId') || '';
}
function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join('');
}
async function sha256base64url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function login() {
  const id = $('clientId').value.trim();
  if (!id) { toast('Bitte zuerst die Client ID eintragen.', true); return; }
  if (store.get('clientId') && store.get('clientId') !== id) store.del('token'); // andere Spotify-App → alter Login gilt nicht
  store.set('clientId', id);
  const verifier = randomString(64), state = randomString(16);
  store.set('pkce', { verifier, state });
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: id, response_type: 'code', redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256', code_challenge: await sha256base64url(verifier),
    scope: SCOPES.join(' '), state,
  });
}
async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    err.code = data.error;
    throw err;
  }
  const old = store.get('token') || {};
  const token = {
    access: data.access_token,
    refresh: data.refresh_token || old.refresh,
    scope: data.scope || old.scope || '',
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  store.set('token', token);
  return token;
}
async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return;
  history.replaceState(null, '', REDIRECT_URI);
  if (q.has('error')) { check('auth', 'fail', 'Spotify meldet: ' + q.get('error')); return; }
  const pkce = store.get('pkce');
  if (!pkce || pkce.state !== q.get('state')) { check('auth', 'fail', 'Login-Status passt nicht, bitte neu anmelden.'); return; }
  try {
    await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI,
      client_id: clientId(), code_verifier: pkce.verifier,
    });
    store.del('pkce');
    log('Login erfolgreich.');
  } catch (e) {
    check('auth', 'fail', e.message);
  }
}
let refreshing = null;
async function getAccessToken() {
  const t = store.get('token');
  if (!t) throw new Error('Nicht angemeldet');
  if (Date.now() < t.expires) return t.access;
  // Mehrere gleichzeitige Anfragen teilen sich eine Erneuerung
  refreshing = refreshing || tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() })
    .catch((e) => {
      if (e.code === 'invalid_grant') { store.del('token'); showLoggedOut('Anmeldung abgelaufen – bitte neu anmelden.'); }
      throw e;
    })
    .finally(() => { refreshing = null; });
  return (await refreshing).access;
}
const hasScope = (s) => (store.get('token')?.scope || '').split(' ').includes(s);
/* Persönliche Daten der angemeldeten Person vom Gerät entfernen.
 * Client ID und Design bleiben, Genres auch (die gehören zu Interpreten, nicht zu Personen). */
function clearUserData() {
  Object.keys(SOURCES).forEach((s) => store.del('lib:' + s));
  store.del('playlistId');
  store.del('me');
  settings.query = '';
  saveSettings();
  $('query').value = '';
  tracks = []; queue = [];
  index = Matcher.buildIndex([], genres);
  ['tracks', 'devices', 'play'].forEach((c) => check(c, '', ''));
  renderQueue(); showParsed();
}
function logout() {
  store.del('token');
  clearUserData();
  showLoggedOut('Abgemeldet. Deine Songs wurden von diesem Gerät entfernt.');
}

/* ---------- Spotify-API ---------- */
async function api(path, opts = {}, attempt = 0) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 429 && attempt < 4) {
    const wait = Math.min(30, Number(res.headers.get('Retry-After') || 2));
    log(`Spotify bremst, warte ${wait}s …`);
    await sleep(wait * 1000);
    return api(path, opts, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) {           // Token serverseitig ungültig → einmal erneuern
    const t = store.get('token'); if (t) { t.expires = 0; store.set('token', t); }
    return api(path, opts, 1);
  }
  if (res.status === 204 || res.status === 202) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.reason = data?.error?.reason;
    throw err;
  }
  return data;
}

/* ---------- Quellen ----------
 * Jede Quelle liefert eine Liste von Tracks {uri, name, album, artists:[{id,name}], addedAt},
 * neueste zuerst. Weitere Quellen (eigene Playlists, gespeicherte Alben) lassen sich hier ergänzen.
 */
const pack = (t) => ({ u: t.uri, n: t.name, al: t.album, a: t.artists.map((a) => [a.id, a.name]), d: t.addedAt });
const unpack = (p) => ({ uri: p.u, name: p.n, album: p.al, artists: p.a.map(([id, name]) => ({ id, name })), addedAt: p.d });
const fromSaved = (it) => it.track && it.track.uri ? {
  uri: it.track.uri, name: it.track.name, album: it.track.album?.name || '',
  artists: (it.track.artists || []).map((a) => ({ id: a.id, name: a.name })), addedAt: it.added_at,
} : null;

const SOURCES = {
  liked: {
    label: 'Lieblingssongs',
    /* Lädt nur neu Hinzugefügtes, solange sich sonst nichts geändert hat. */
    async sync(cached, full, progress) {
      const keyOf = (t) => t.uri + '|' + t.addedAt;
      if (!full && cached?.length) {
        const topKey = keyOf(cached[0]);
        const fresh = [];
        let offset = 0, total = 0, found = false;
        while (!found && offset < 1000) {
          const page = await api(`/me/tracks?limit=50&offset=${offset}`);
          total = page.total;
          for (const it of page.items) {
            const t = fromSaved(it);
            if (!t) continue;
            if (keyOf(t) === topKey) { found = true; break; }
            fresh.push(t);
          }
          if (!page.next) break;
          offset += 50;
        }
        const merged = fresh.concat(cached);
        if (found && merged.length === total) return { tracks: merged, added: fresh.length };
        log('Bibliothek hat sich stärker geändert, lade komplett neu.');
      }
      const tracks = [];
      let offset = 0;
      for (;;) {
        const page = await api(`/me/tracks?limit=50&offset=${offset}`);
        for (const it of page.items) { const t = fromSaved(it); if (t) tracks.push(t); }
        progress(`${tracks.length} von ${page.total} Songs …`);
        if (!page.next) break;
        offset += 50;
      }
      return { tracks, added: tracks.length, full: true };
    },
  },
};

/* ---------- Zustand ---------- */
let me = null;
let tracks = [];
let genres = store.get('genreCache') || {};
let index = Matcher.buildIndex([], genres);
let queue = [];
let syncing = false;

function setLibStatus() {
  const src = SOURCES[settings.source];
  const lib = store.get('lib:' + settings.source);
  if (!store.get('token')) { $('libStatus').textContent = 'Nicht verbunden'; return; }
  $('libStatus').textContent = tracks.length
    ? `${src.label} · ${tracks.length.toLocaleString('de-DE')} Songs`
    : 'Bibliothek wird geladen …';
  $('libInfo').textContent = lib?.syncedAt
    ? `${tracks.length} Songs gespeichert, zuletzt abgeglichen ${new Date(lib.syncedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.`
    : 'Noch nichts geladen.';
}

function loadCachedLibrary() {
  const lib = store.get('lib:' + settings.source);
  tracks = lib?.tracks ? lib.tracks.map(unpack) : [];
  index = Matcher.buildIndex(tracks, genres);
  if (tracks.length) check('tracks', 'ok', `${tracks.length} Songs aus dem Gerätespeicher`);
  setLibStatus();
}

async function syncLibrary(full = false) {
  if (syncing) return;
  syncing = true;
  $('reloadBtn').disabled = true;
  check('tracks', 'wait', full ? 'lade komplett …' : 'gleiche ab …');
  try {
    const result = await SOURCES[settings.source].sync(tracks, full, (msg) => { $('libStatus').textContent = msg; });
    tracks = result.tracks;
    const ok = store.set('lib:' + settings.source, { tracks: tracks.map(pack), syncedAt: Date.now() });
    if (!ok) toast('Bibliothek zu groß für den Gerätespeicher – wird beim nächsten Start neu geladen.', true);
    index = Matcher.buildIndex(tracks, genres);
    check('tracks', 'ok', `${tracks.length} Songs` + (result.added && !result.full ? `, ${result.added} neu` : ''));
    if (result.added && !result.full) toast(`${result.added} neue Lieblingssongs übernommen.`);
    log(`Bibliothek abgeglichen: ${tracks.length} Songs (${result.full ? 'komplett' : result.added + ' neu'}).`);
    makeShuffle();
    loadMissingGenres();
  } catch (e) {
    check('tracks', 'fail', e.message);
    if (!tracks.length) toast('Songs konnten nicht geladen werden: ' + e.message, true);
  } finally {
    syncing = false;
    $('reloadBtn').disabled = false;
    setLibStatus();
  }
}

/* Genres hängen an den Interpreten. Spotify erlaubt seit 2026 nur Einzelabfragen,
 * daher im Hintergrund nacheinander – jeder Interpret wird nur einmal geladen. */
let genreRun = false;
async function loadMissingGenres() {
  if (genreRun) return;
  genreRun = true;
  const ids = [...new Set(tracks.flatMap((t) => t.artists.map((a) => a.id)).filter(Boolean))];
  const missing = ids.filter((id) => !(id in genres));
  let done = 0;
  try {
    for (const id of missing) {
      try { genres[id] = (await api('/artists/' + id)).genres || []; }
      catch (e) { if (e.status === 404) genres[id] = []; else throw e; }
      done++;
      if (done % 20 === 0 || done === missing.length) {
        store.set('genreCache', genres);
        check('genres', 'wait', `${done} von ${missing.length} Interpreten …`);
      }
      await sleep(120);
    }
    const withGenre = ids.filter((id) => genres[id]?.length).length;
    check('genres', 'ok', `${withGenre} von ${ids.length} Interpreten mit Genre-Angabe`);
    if (missing.length) { index = Matcher.buildIndex(tracks, genres); showParsed(); }
  } catch (e) {
    store.set('genreCache', genres);
    check('genres', 'fail', `${done} geladen, dann Fehler: ${e.message}. Wird beim nächsten Start fortgesetzt.`);
  } finally {
    genreRun = false;
  }
}

/* ---------- Kriterien ---------- */
function currentCriteria() {
  const q = Matcher.parseQuery($('query').value);
  const count = q.count || (settings.count === 'all' ? Infinity : Number(settings.count));
  return {
    count,
    countFromVoice: !!q.count,
    include: q.include.map((t) => ({ term: t, ...Matcher.resolveTerm(t, index) })),
    exclude: q.exclude.map((t) => ({ term: t, ...Matcher.resolveTerm(t, index) })),
  };
}
function showParsed() {
  const c = currentCriteria();
  const tag = (r, out) => {
    const fixed = r.fixed ? ` <small>statt „${escapeHtml(r.term)}“</small>` : '';
    const kind = r.type === 'text' ? ' <small>Titel</small>' : '';
    return `<span class="tag${out ? ' out' : ''}">${escapeHtml(r.label)}${fixed}${kind}</span>`;
  };
  const parts = [];
  if (c.countFromVoice) parts.push(`<span class="tag">${c.count === Infinity ? 'Alle' : 'Letzte ' + c.count}</span>`);
  parts.push(...c.include.map((r) => tag(r, false)), ...c.exclude.map((r) => tag(r, true)));
  $('parsed').innerHTML = parts.join('');
}
function renderChips() {
  document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.count === settings.count)));
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
/* Mischen, dann so umsortieren, dass derselbe Interpret möglichst
 * nicht direkt hintereinander und nicht innerhalb von 3 Songs wiederkommt. */
function spreadArtists(list) {
  const pool = shuffleArray(list);
  const out = [];
  while (pool.length) {
    const recent = out.slice(-3).map((t) => t.artists[0]?.id);
    let idx = pool.findIndex((t) => !recent.includes(t.artists[0]?.id));
    if (idx === -1) idx = pool.findIndex((t) => t.artists[0]?.id !== recent[recent.length - 1]);
    if (idx === -1) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
function makeShuffle() {
  showParsed();
  const c = currentCriteria();
  let pool = tracks.slice(0, c.count);
  if (c.include.length) pool = pool.filter((t) => c.include.some((r) => Matcher.trackMatches(t, r, genres)));
  if (c.exclude.length) pool = pool.filter((t) => !c.exclude.some((r) => Matcher.trackMatches(t, r, genres)));
  queue = spreadArtists(pool);
  renderQueue();
  $('playBtn').disabled = !queue.length;
  $('shuffleBtn').disabled = !tracks.length;
  if (tracks.length && !queue.length) {
    const genreWanted = c.include.some((r) => r.type === 'genre');
    toast(genreWanted && genreRun ? 'Keine Treffer – Genres werden noch geladen.' : 'Keine Songs passen zu diesem Wunsch.', true);
  } else if ($('toast').classList.contains('bad')) toast('');
}
function renderQueue() {
  $('count').textContent = queue.length ? `· ${queue.length}` : '';
  $('empty').hidden = !!tracks.length;
  const shown = queue.slice(0, 300);
  $('list').innerHTML = shown.map((t) =>
    `<li><span class="t">${escapeHtml(t.name)}</span><span class="a">${escapeHtml(t.artists.map((a) => a.name).join(', '))}</span></li>`).join('')
    + (queue.length > shown.length ? `<li><span class="a">… und ${queue.length - shown.length} weitere</span></li>` : '');
}

/* ---------- Wiedergabe ---------- */
async function ensurePlaylist() {
  let id = store.get('playlistId');
  if (id) {
    try {
      const p = await api(`/playlists/${id}?fields=id,uri,owner(id)`);
      if (p && p.owner?.id === me?.id) return p;
    } catch (e) { log('Shuffle-Playlist nicht mehr gefunden, lege neu an.'); }
  }
  const p = await api('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: PLAYLIST_NAME, public: false, description: 'Wird von der Smart-Shuffle-App bei jedem Abspielen neu befüllt.' }),
  });
  store.set('playlistId', p.id);
  log('Private Playlist „' + PLAYLIST_NAME + '“ angelegt.');
  return p;
}
async function fillPlaylist(id, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await api(`/playlists/${id}/items`, { method: i === 0 ? 'PUT' : 'POST', body: JSON.stringify({ uris: chunk }) });
  }
}
async function play() {
  if (!queue.length) return;
  $('playBtn').disabled = true;
  check('devices', 'wait');
  try {
    const { devices } = await api('/me/player/devices');
    if (!devices.length) {
      check('devices', 'fail', 'Kein Gerät gefunden');
      toast('Öffne kurz die Spotify-App, dann nochmal abspielen.', true);
      return;
    }
    const device = devices.find((d) => d.is_active) || devices.find((d) => d.type === 'Smartphone') || devices[0];
    check('devices', 'ok', `${device.name} (${device.type})`);
    check('play', 'wait');
    const dev = `device_id=${encodeURIComponent(device.id)}`;
    const uris = queue.map((t) => t.uri);
    let body;
    if (hasScope('playlist-modify-private')) {
      toast('Übertrage Reihenfolge …');
      const p = await ensurePlaylist();
      await fillPlaylist(p.id, uris);
      body = { context_uri: p.uri, offset: { position: 0 } };
    } else {
      body = { uris: uris.slice(0, 100) };
      log('Ohne Playlist-Recht: nur die ersten 100 Songs. Einmal neu anmelden behebt das.');
    }
    await api(`/me/player/shuffle?state=false&${dev}`, { method: 'PUT' }).catch(() => {});
    await api(`/me/player/play?${dev}`, { method: 'PUT', body: JSON.stringify(body) });
    check('play', 'ok', `${queue.length} Songs auf ${device.name}`);
    toast(`Läuft auf ${device.name}: ${queue[0].name}`);
  } catch (e) {
    const hint = e.status === 403 ? ' Premium nötig?' : e.status === 404 ? ' Spotify-App kurz öffnen.' : '';
    check('play', 'fail', e.message + hint);
    toast('Abspielen fehlgeschlagen: ' + e.message + hint, true);
  } finally {
    $('playBtn').disabled = !queue.length;
  }
}

/* ---------- Spracheingabe ---------- */
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    check('speech', 'fail', 'Dieser Browser kann keine Spracheingabe – auf dem iPhone Safari nutzen.');
    $('micBtn').disabled = true;
    return;
  }
  check('speech', '', 'verfügbar');
  const rec = new SR();
  rec.lang = 'de-DE';
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false, heard = '';
  rec.onstart = () => { listening = true; heard = ''; $('micBtn').classList.add('listening'); toast('Ich höre zu …'); };
  rec.onend = () => {
    listening = false;
    $('micBtn').classList.remove('listening');
    if (heard) { settings.query = heard; saveSettings(); makeShuffle(); toast(''); }
    else toast('Nichts verstanden – nochmal versuchen.', true);
  };
  rec.onresult = (ev) => {
    heard = Array.from(ev.results).map((r) => r[0].transcript).join(' ').trim();
    $('query').value = heard;
    showParsed();
    if (ev.results[ev.results.length - 1].isFinal) { check('speech', 'ok', `zuletzt: „${heard}“`); log('Gehört: ' + heard); }
  };
  rec.onerror = (ev) => {
    if (ev.error === 'no-speech' || ev.error === 'aborted') return;
    check('speech', 'fail', ev.error === 'not-allowed' ? 'Mikrofon-Zugriff verweigert' : ev.error);
    toast(ev.error === 'not-allowed' ? 'Mikrofon in den Safari-Einstellungen erlauben.' : 'Spracheingabe: ' + ev.error, true);
  };
  $('micBtn').addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    try { rec.start(); } catch (e) { log('Spracheingabe: ' + e.message); }
  });
}

/* ---------- Ansichten ---------- */
function showLoggedOut(msg) {
  me = null;
  $('logoutBtn').hidden = true;
  $('loginBtn').textContent = 'Mit Spotify anmelden';
  $('playBtn').disabled = true;
  check('auth', '', '');
  setLibStatus();
  if (msg) toast(msg, true);
}
async function loadProfile() {
  check('profile', 'wait');
  try {
    me = await api('/me');
    const prev = store.get('me');
    if (prev && prev.id !== me.id) {          // andere Person hat sich auf diesem Gerät angemeldet
      clearUserData();
      log('Neue Person angemeldet – vorherige Bibliothek entfernt.');
    }
    store.set('me', { id: me.id, name: me.display_name });
    const premium = me.product === 'premium';
    check('auth', 'ok');
    check('profile', premium ? 'ok' : 'fail', `${me.display_name || me.id} · ${premium ? 'Premium' : 'kein Premium – Abspielen nicht möglich'}`);
    $('logoutBtn').hidden = false;
    $('loginBtn').textContent = 'Neu anmelden';
    if (!SCOPES.every(hasScope)) toast('Neue Funktionen: bitte in den Einstellungen einmal neu anmelden.', true);
    return true;
  } catch (e) {
    check('profile', 'fail', e.message);
    if (e.status === 403) log('403: Steht dein Konto im Spotify-Dashboard unter „User Management“?');
    return false;
  }
}

/* ---------- Start ---------- */
async function init() {
  renderThemePicker();
  applyTheme(settings.theme);
  renderChips();

  $('redirectUri').textContent = REDIRECT_URI;
  $('redirectUri').addEventListener('click', () => navigator.clipboard?.writeText(REDIRECT_URI).then(() => toast('Redirect URI kopiert.')));
  $('clientId').value = clientId();
  $('clientId').addEventListener('change', () => store.set('clientId', $('clientId').value.trim()));
  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', logout);
  $('reloadBtn').addEventListener('click', () => syncLibrary(true));
  $('settingsBtn').addEventListener('click', () => $('settings').showModal());
  $('closeSettings').addEventListener('click', () => $('settings').close());
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); });
  $('shuffleBtn').addEventListener('click', makeShuffle);
  $('playBtn').addEventListener('click', play);
  document.querySelector('.chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    settings.count = b.dataset.count; saveSettings(); renderChips(); makeShuffle();
  });
  $('source').value = settings.source;
  let typing;
  $('query').value = settings.query || '';
  $('query').addEventListener('input', () => {
    showParsed();
    clearTimeout(typing);
    typing = setTimeout(() => { settings.query = $('query').value; saveSettings(); makeShuffle(); }, 500);
  });
  $('query').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('query').blur(); makeShuffle(); } });
  setupSpeech();

  await handleRedirect();
  loadCachedLibrary();
  if (tracks.length) makeShuffle(); else renderQueue();

  if (!store.get('token')) {
    showLoggedOut();
    $('settings').showModal();
    return;
  }
  if (await loadProfile()) {
    await syncLibrary(false);
    if (!syncing) loadMissingGenres();
  }
}

init();
