/* Smart Shuffle – KI-Worker (Cloudflare Workers)
 *
 * Mittelsmann zwischen App und Claude-API:
 *   POST /interpret    Sprachwunsch → Filter (Interpreten, Genres, Jahre, Anzahl)
 *   POST /tag-artists  Interpretennamen → Genres (einmalig, die App speichert das Ergebnis)
 *   POST /discover     neue, ähnliche Songs von Last.fm (Hördaten) und Claude, Anteile steuerbar
 *   GET  /health       Zustand der Einrichtung
 * Jede POST-Anfrage braucht einen gültigen Spotify-Login (Authorization-Header),
 * und die Spotify-ID muss in ALLOWED_USERS stehen.
 *
 * Einstellungen (Cloudflare → Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (Secret, Pflicht)  API-Schlüssel aus der Anthropic Console
 *   ALLOWED_USERS      (Pflicht)          Spotify-Nutzer-IDs, kommagetrennt (stehen in der App unter Einstellungen → KI)
 *   ALLOWED_ORIGINS    (optional)         erlaubte Web-Adressen der App, Standard siehe wrangler.toml
 *   MODEL              (optional)         Standard: claude-haiku-5-5
 *   DAILY_LIMIT        (optional)         KI-Anfragen pro Person und Tag, Standard 200 (nur mit KV-Bindung USAGE)
 *   LASTFM_API_KEY     (Secret, optional) Schlüssel von last.fm/api für ähnliche Songs aus echten Hördaten
 */

const VERSION = '2026-10-09.4';
const MAX_TEXT = 400;
const MAX_ARTISTS = 2500;
const MAX_GENRES = 1200;
const TAG_BATCH = 150;

/* ---------- Wunsch → Filter ---------- */
const FILTER_TOOL = {
  name: 'set_shuffle_filter',
  description: 'Setzt die Filter für den Shuffle über die Lieblingssongs der Person.',
  input_schema: {
    type: 'object',
    properties: {
      include_artists: { type: 'array', items: { type: 'string' }, description: 'Interpreten, deren Songs gespielt werden sollen. Nur exakte Namen aus der Interpretenliste.' },
      exclude_artists: { type: 'array', items: { type: 'string' }, description: 'Interpreten, die ausgeschlossen werden. Nur exakte Namen aus der Liste.' },
      include_genres: { type: 'array', items: { type: 'string' }, description: 'Genres, die gespielt werden sollen. Nur exakte Einträge aus der Genreliste.' },
      exclude_genres: { type: 'array', items: { type: 'string' }, description: 'Genres, die ausgeschlossen werden. Nur exakte Einträge aus der Genreliste.' },
      title_keywords: { type: 'array', items: { type: 'string' }, description: 'Nur wenn ausdrücklich nach Wörtern im Songtitel gefragt wird.' },
      year_from: { type: ['integer', 'null'], description: 'Frühestes Erscheinungsjahr, z. B. „90er“ → 1990. null = keine Einschränkung.' },
      year_to: { type: ['integer', 'null'], description: 'Spätestes Erscheinungsjahr, z. B. „90er“ → 1999. null = keine Einschränkung.' },
      count: { type: ['integer', 'null'], description: 'Anzahl der zuletzt gespeicherten Songs, wenn genannt („die letzten 50“ → 50). 0 = ausdrücklich alle. null = nicht erwähnt.' },
      summary: { type: 'string', description: 'Sehr kurze deutsche Bestätigung, was gespielt wird (max. 10 Wörter).' },
    },
    required: ['include_artists', 'exclude_artists', 'include_genres', 'exclude_genres', 'year_from', 'year_to', 'count', 'summary'],
  },
};

const FILTER_INSTRUCTIONS = `Du übersetzt einen gesprochenen deutschen Musikwunsch in Filter für einen Shuffle über die Lieblingssongs einer Person.
Der Text stammt aus einer Spracherkennung und enthält oft falsch geschriebene Namen („Kraft Club“ = Kraftklub, „Billy Eilish“ = Billie Eilish).

Regeln:
- Interpreten: nur exakte Namen aus der Interpretenliste unten. Ordne Hörfehler dem gemeinten Interpreten zu.
- Genres: nur exakte Einträge aus der Genreliste unten. Übersetze allgemeine Begriffe („Rock“, „Rap“, „Elektro“, „Deutschpop“) in ALLE passenden Genres der Liste (bei „Rock“ z. B. auch alternative rock, hard rock, indie rock, punk rock …).
- Die Genreliste kann lückenhaft sein. Wähle deshalb bei Genre-, Stimmungs- und Anlasswünschen zusätzlich großzügig ALLE Interpreten aus der Liste, die nach deinem Wissen eindeutig passen – das dürfen auch viele sein.
- Stimmungen und Anlässe („was Ruhiges“, „zum Feiern“, „zum Joggen“, „zum Einschlafen“): passende Genres plus passende Interpreten.
- Jahrzehnte und Jahre („90er“, „aus den 2000ern“, „Songs von 1995“) → year_from / year_to. Das Jahrzehnt allein ist KEIN Genre und kein Interpret.
- Ein Song wird gespielt, wenn er zu IRGENDEINEM Einschluss passt, zu KEINEM Ausschluss und im Jahresbereich liegt. Leere Einschlusslisten bedeuten: alle Songs (nur Jahre/Ausschlüsse gelten).
- „ohne“, „kein“, „nicht“, „außer“ → Ausschlüsse.
- Erfinde nichts, was nicht in den Listen steht.
- Antworte ausschließlich über das Werkzeug set_shuffle_filter.`;

/* ---------- Interpreten → Genres ---------- */
const TAG_TOOL = {
  name: 'set_artist_genres',
  description: 'Ordnet jedem nummerierten Interpreten seine Genres zu.',
  input_schema: {
    type: 'object',
    properties: {
      artists: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer', description: 'Nummer des Interpreten aus der Liste' },
            g: { type: 'array', items: { type: 'string' }, description: '1–4 Genres, klein geschrieben; leer, wenn unbekannt' },
          },
          required: ['i', 'g'],
        },
      },
    },
    required: ['artists'],
  },
};

const TAG_INSTRUCTIONS = `Ordne jedem Interpreten der nummerierten Liste 1 bis 4 Genres zu – so, wie Spotify Genres benennt:
englisch, klein geschrieben, vom Allgemeinen zum Speziellen, z. B. „rock“, „alternative rock“, „pop“, „german pop“,
„hip hop“, „german hip hop“, „indie“, „indie rock“, „electronic“, „techno“, „house“, „schlager“, „metal“, „punk“,
„r&b“, „soul“, „jazz“, „classical“, „singer-songwriter“, „acoustic“, „ambient“, „latin“, „reggaeton“, „country“, „folk“.
Nimm immer auch das Hauptgenre mit (bei „german hip hop“ zusätzlich „hip hop“; bei „indie rock“ zusätzlich „rock“).
Kennst du einen Interpreten nicht sicher, gib eine leere Liste zurück. Rate nicht.
Antworte ausschließlich über das Werkzeug set_artist_genres und gib für JEDE Nummer einen Eintrag zurück.`;

/* ---------- Neue Songs entdecken ---------- */
const DISCOVER_TOOL = {
  name: 'suggest_songs',
  description: 'Schlägt existierende Songs vor, die die Person noch entdecken kann.',
  input_schema: {
    type: 'object',
    properties: {
      songs: {
        type: 'array',
        items: {
          type: 'object',
          properties: { artist: { type: 'string' }, title: { type: 'string' } },
          required: ['artist', 'title'],
        },
      },
    },
    required: ['songs'],
  },
};

const DISCOVER_INSTRUCTIONS = `Du schlägst Songs vor, die eine Person noch nicht kennt, die aber zu ihrem Geschmack und ihrem aktuellen Wunsch passen – wie ein guter Genre-Mix eines Streamingdienstes.
Unten stehen Interpreten aus ihrer Bibliothek (Geschmack) und Beispielsongs aus ihrer aktuellen Auswahl.

Regeln:
- Nur Songs, von denen du sicher bist, dass sie unter genau diesem Titel und Interpreten existieren. Keine erfundenen Titel.
- Keine der Beispielsongs. Mische weniger bekannte Songs bekannter Lieblingsinterpreten mit passenden Interpreten, die nicht in der Liste stehen.
- Höchstens 2 Songs pro Interpret.
- Halte dich an Wunsch, Stimmung und Jahresbereich, falls angegeben.
- Titel ohne Zusätze wie „Remastered“ oder „Radio Edit“.
- Antworte ausschließlich über das Werkzeug suggest_songs.`;

const songKey = (artist, title) => `${String(artist).toLowerCase().trim()}|${String(title).toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim()}`;

/* Ähnliche Songs aus Last.fm-Hördaten für mehrere Startsongs, zusammengeführt nach Ähnlichkeit. */
async function lastfmSimilar(env, seeds, want) {
  if (want <= 0) return { items: [] };
  if (!env.LASTFM_API_KEY) return { items: [], note: 'Last.fm-Schlüssel fehlt auf dem Server' };
  const perSeed = Math.min(50, Math.max(10, Math.ceil((want * 4) / Math.max(1, seeds.length))));
  const lists = await Promise.all(seeds.slice(0, 8).map(async (s) => {
    const u = new URL('https://ws.audioscrobbler.com/2.0/');
    u.search = new URLSearchParams({
      method: 'track.getsimilar', artist: s.artist, track: s.title, autocorrect: '1',
      limit: String(perSeed), api_key: env.LASTFM_API_KEY, format: 'json',
    });
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'SmartShuffle/1.0 (private Web-App)' } });
      const d = await r.json();
      if (d.error) return { error: d.message || `Last.fm-Fehler ${d.error}` };
      return (d.similartracks?.track || []).map((t) => ({ artist: t.artist?.name, title: t.name, score: Number(t.match) || 0 }));
    } catch (e) {
      return { error: e.message };
    }
  }));
  const errors = lists.filter((l) => l && l.error).map((l) => l.error);
  const best = new Map();
  for (const l of lists) if (Array.isArray(l)) for (const t of l) {
    if (!t.artist || !t.title) continue;
    const k = songKey(t.artist, t.title);
    if (!best.has(k) || best.get(k).score < t.score) best.set(k, t);
  }
  const seedKeys = new Set(seeds.map((s) => songKey(s.artist, s.title)));
  const perArtist = new Map();
  const items = [];
  for (const t of [...best.values()].sort((a, b) => b.score - a.score)) {
    if (seedKeys.has(songKey(t.artist, t.title))) continue;
    const a = t.artist.toLowerCase();
    if ((perArtist.get(a) || 0) >= 2) continue;
    perArtist.set(a, (perArtist.get(a) || 0) + 1);
    items.push({ artist: t.artist, title: t.title, source: 'lastfm' });
    if (items.length >= want * 2) break;
  }
  return { items, note: !items.length && errors.length ? 'Last.fm: ' + errors[0] : null };
}

async function kiSuggest(env, body, seeds, want) {
  if (want <= 0) return { items: [] };
  const artists = cleanStrings(body.artists, 400);
  const years = body.years && (body.years.from || body.years.to) ? `${body.years.from || '–'} bis ${body.years.to || '–'}` : 'keine Einschränkung';
  const { input, usage } = await callClaude(env, {
    system: [
      { type: 'text', text: DISCOVER_INSTRUCTIONS },
      { type: 'text', text: `Interpreten aus der Bibliothek:\n${artists.join('\n')}`, cache_control: { type: 'ephemeral' } },
    ],
    tool: DISCOVER_TOOL,
    user: `Wunsch: ${String(body.text || '').slice(0, MAX_TEXT) || '(kein besonderer Wunsch – passend zum Geschmack)'}
Jahresbereich: ${years}
Beispielsongs aus der aktuellen Auswahl:
${seeds.map((s) => `- ${s.artist} – ${s.title}`).join('\n') || '(keine)'}
Anzahl Vorschläge: ${want * 2}`,
    maxTokens: 4096,
  });
  const seedKeys = new Set(seeds.map((s) => songKey(s.artist, s.title)));
  const items = (Array.isArray(input.songs) ? input.songs : [])
    .filter((s) => s && typeof s.artist === 'string' && typeof s.title === 'string' && !seedKeys.has(songKey(s.artist, s.title)))
    .slice(0, want * 2)
    .map((s) => ({ artist: s.artist.slice(0, 120), title: s.title.slice(0, 160), source: 'ki' }));
  return { items, usage };
}

async function discover(env, body) {
  const count = Math.max(1, Math.min(50, Number(body.count) || 10));
  const kiShare = Math.max(0, Math.min(100, Number(body.kiShare ?? 50)));
  const seeds = (Array.isArray(body.seeds) ? body.seeds : [])
    .filter((s) => s && typeof s.artist === 'string' && typeof s.title === 'string')
    .slice(0, 8).map((s) => ({ artist: s.artist.slice(0, 120), title: s.title.slice(0, 160) }));
  const wantKi = Math.round((count * kiShare) / 100);
  const wantLast = count - wantKi;
  const notes = [];

  const last = await lastfmSimilar(env, seeds, wantLast);
  if (last.note) notes.push(last.note);
  // Liefert Last.fm zu wenig, springt die KI ein – aber nur, wenn sie nicht ganz abgeschaltet ist.
  const shortfall = Math.max(0, wantLast - Math.floor(last.items.length / 2));
  const kiWant = kiShare > 0 ? wantKi + shortfall : 0;
  let ki = { items: [] };
  try { ki = await kiSuggest(env, body, seeds, kiWant); }
  catch (e) { notes.push(e.message); }
  if (shortfall && kiShare > 0) notes.push(`KI ergänzt ${shortfall} Vorschläge, die Last.fm nicht liefern konnte`);

  return { wantLast, wantKi, lastfm: last.items, ki: ki.items, notes, usage: ki.usage || null };
}

/* ---------- Hilfen ---------- */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
}
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const cleanStrings = (arr, max, maxLen = 120) =>
  Array.isArray(arr) ? [...new Set(arr.filter((s) => typeof s === 'string').map((s) => s.trim().slice(0, maxLen)).filter(Boolean))].slice(0, max) : [];
const intOrNull = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/* Nur zurückgeben, was wirklich in der Bibliothek vorkommt (Groß-/Kleinschreibung egal). */
function keepKnown(values, known) {
  const map = new Map(known.map((k) => [k.toLowerCase(), k]));
  return [...new Set((values || []).map((v) => map.get(String(v).toLowerCase())).filter(Boolean))];
}

async function spotifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: authHeader } });
  if (!res.ok) return null;
  const me = await res.json();
  return me && me.id ? me : null;
}

async function checkDailyLimit(env, userId) {
  if (!env.USAGE) return { ok: true };                       // ohne KV-Bindung kein Limit
  const limit = Number(env.DAILY_LIMIT || 200);
  const key = `u:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.USAGE.get(key)) || 0);
  if (used >= limit) return { ok: false, limit };
  await env.USAGE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true, used: used + 1, limit };
}

async function callClaude(env, { system, tool, user, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-haiku-5-5',
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error('KI-Fehler: ' + msg), { status: 502 });
  }
  const call = (data.content || []).find((c) => c.type === 'tool_use' && c.name === tool.name);
  if (!call) throw Object.assign(new Error('KI hat kein Ergebnis geliefert'), { status: 502 });
  const u = data.usage || {};
  return { input: call.input, usage: { input: u.input_tokens, output: u.output_tokens, cached: u.cache_read_input_tokens || 0 } };
}

/* ---------- Endpunkte ---------- */
async function interpret(env, body) {
  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  if (!text) throw Object.assign(new Error('Kein Wunsch übermittelt'), { status: 400 });
  const artists = cleanStrings(body.artists, MAX_ARTISTS);
  const genres = cleanStrings(body.genres, MAX_GENRES, 80);
  const library = `Interpretenliste (${artists.length}):\n${artists.join('\n')}\n\nGenreliste (${genres.length}):\n${genres.join('\n') || '(keine Genres bekannt)'}`;
  const { input, usage } = await callClaude(env, {
    system: [
      { type: 'text', text: FILTER_INSTRUCTIONS },
      { type: 'text', text: library, cache_control: { type: 'ephemeral' } }, // Bibliothek ändert sich selten → günstiger
    ],
    tool: FILTER_TOOL,
    user: `Wunsch: ${text}`,
    maxTokens: 4096,
  });
  let yearFrom = intOrNull(input.year_from, 1900, 2100);
  let yearTo = intOrNull(input.year_to, 1900, 2100);
  if (yearFrom && yearTo && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  return {
    filter: {
      include_artists: keepKnown(input.include_artists, artists),
      exclude_artists: keepKnown(input.exclude_artists, artists),
      include_genres: keepKnown(input.include_genres, genres),
      exclude_genres: keepKnown(input.exclude_genres, genres),
      title_keywords: cleanStrings(input.title_keywords, 10, 60),
      year_from: yearFrom,
      year_to: yearTo,
      count: intOrNull(input.count, 0, 100000),
      summary: String(input.summary || '').slice(0, 120),
    },
    usage,
  };
}

async function tagArtists(env, body) {
  const artists = cleanStrings(body.artists, TAG_BATCH);
  if (!artists.length) throw Object.assign(new Error('Keine Interpreten übermittelt'), { status: 400 });
  const numbered = artists.map((a, i) => `${i + 1}. ${a}`).join('\n');
  const { input, usage } = await callClaude(env, {
    system: [{ type: 'text', text: TAG_INSTRUCTIONS }],
    tool: TAG_TOOL,
    user: numbered,
    maxTokens: 8192,
  });
  const tags = {};
  for (const row of Array.isArray(input.artists) ? input.artists : []) {
    const idx = Number(row.i) - 1;
    if (idx >= 0 && idx < artists.length) {
      tags[artists[idx]] = cleanStrings(row.g, 4, 40).map((g) => g.toLowerCase());
    }
  }
  return { tags, usage };
}

/* ---------- Einstieg ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const originOk = list(env.ALLOWED_ORIGINS || 'https://servusgruss.github.io').includes(origin);
    const cors = originOk ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });

    if (url.pathname === '/health') {
      return json({
        ok: true,
        version: VERSION,
        apiKey: !!env.ANTHROPIC_API_KEY,
        lastfm: !!env.LASTFM_API_KEY,
        allowedUsers: list(env.ALLOWED_USERS).length,
        dailyLimit: env.USAGE ? Number(env.DAILY_LIMIT || 200) : null,
        model: env.MODEL || 'claude-haiku-5-5',
      }, 200, { ...cors, 'Cache-Control': 'no-store' });
    }

    const routes = { '/interpret': interpret, '/tag-artists': tagArtists, '/discover': discover };
    const handler = routes[url.pathname];
    if (!handler || request.method !== 'POST') return json({ error: 'Nicht gefunden' }, 404, cors);
    if (!originOk) return json({ error: 'Diese Web-Adresse ist nicht freigegeben (ALLOWED_ORIGINS).' }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Auf dem Server fehlt der API-Schlüssel (ANTHROPIC_API_KEY).' }, 500, cors);

    const me = await spotifyUser(request.headers.get('Authorization'));
    if (!me) return json({ error: 'Spotify-Anmeldung ungültig – in der App neu anmelden.' }, 401, cors);
    if (!list(env.ALLOWED_USERS).includes(me.id)) {
      return json({ error: `Dein Spotify-Konto ist für die KI nicht freigegeben. Trage „${me.id}“ in ALLOWED_USERS ein.`, userId: me.id }, 403, cors);
    }

    const limit = await checkDailyLimit(env, me.id);
    if (!limit.ok) return json({ error: `Tageslimit von ${limit.limit} KI-Anfragen erreicht.` }, 429, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400, cors); }
    try {
      return json(await handler(env, body), 200, cors);
    } catch (e) {
      return json({ error: e.message }, e.status || 500, cors);
    }
  },
};
