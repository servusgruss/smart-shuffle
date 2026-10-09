/* Smart Shuffle – KI-Worker (Cloudflare Workers)
 *
 * Mittelsmann zwischen App und Claude-API:
 *   App → POST /interpret  (Spotify-Token im Authorization-Header)
 *       → Worker prüft Herkunft, Spotify-Login, Freigabeliste und Tageslimit
 *       → Worker fragt Claude (API-Schlüssel liegt nur hier als Secret)
 *       → gibt Filter zurück: Interpreten, Genres, Stichwörter, Anzahl
 *
 * Einstellungen (Cloudflare → Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (Secret, Pflicht)  API-Schlüssel aus der Anthropic Console
 *   ALLOWED_USERS      (Pflicht)          Spotify-Nutzer-IDs, kommagetrennt (stehen in der App unter Einstellungen → KI)
 *   ALLOWED_ORIGINS    (optional)         erlaubte Web-Adressen der App, Standard siehe wrangler.toml
 *   MODEL              (optional)         Standard: claude-haiku-5-5
 *   DAILY_LIMIT        (optional)         KI-Anfragen pro Person und Tag, Standard 200 (nur mit KV-Bindung USAGE)
 */

const MAX_TEXT = 400;
const MAX_ARTISTS = 2500;
const MAX_GENRES = 800;

const TOOL = {
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
      count: { type: ['integer', 'null'], description: 'Anzahl der zuletzt gespeicherten Songs, wenn genannt („die letzten 50“ → 50). 0 = ausdrücklich alle. null = nicht erwähnt.' },
      summary: { type: 'string', description: 'Sehr kurze deutsche Bestätigung, was gespielt wird (max. 10 Wörter).' },
    },
    required: ['include_artists', 'exclude_artists', 'include_genres', 'exclude_genres', 'count', 'summary'],
  },
};

const INSTRUCTIONS = `Du übersetzt einen gesprochenen deutschen Musikwunsch in Filter für einen Shuffle über die Lieblingssongs einer Person.
Der Text stammt aus einer Spracherkennung und enthält oft falsch geschriebene Namen („Kraft Club“ = Kraftklub, „Billy Eilish“ = Billie Eilish).

Regeln:
- Interpreten: nur exakte Namen aus der Interpretenliste unten. Ordne Hörfehler dem gemeinten Interpreten zu.
- Genres: nur exakte Einträge aus der Genreliste unten. Übersetze allgemeine Begriffe („Rap“, „Elektro“, „Deutschpop“) in alle passenden Genres der Liste.
- Stimmungen und Anlässe („was Ruhiges“, „zum Feiern“, „zum Joggen“, „zum Einschlafen“): wähle passende Genres aus der Liste und zusätzlich Interpreten aus der Liste, die du sicher als passend kennst.
- Ein Song wird gespielt, wenn er zu IRGENDEINEM Einschluss passt und zu KEINEM Ausschluss. Leere Einschlusslisten bedeuten: alle Songs.
- „ohne“, „kein“, „nicht“, „außer“ → Ausschlüsse.
- Erfinde nichts, was nicht in den Listen steht. Im Zweifel lieber weniger Filter.
- Antworte ausschließlich über das Werkzeug set_shuffle_filter.`;

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

async function askClaude(env, text, artists, genres) {
  const library = `Interpretenliste (${artists.length}):\n${artists.join('\n')}\n\nGenreliste (${genres.length}):\n${genres.join('\n') || '(keine Genres bekannt)'}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-haiku-5-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: INSTRUCTIONS },
        { type: 'text', text: library, cache_control: { type: 'ephemeral' } }, // Bibliothek ändert sich selten → günstiger
      ],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: `Wunsch: ${text}` }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error('KI-Fehler: ' + msg), { status: 502 });
  }
  const call = (data.content || []).find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  if (!call) throw Object.assign(new Error('KI hat kein Ergebnis geliefert'), { status: 502 });
  return { input: call.input, usage: data.usage };
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
        apiKey: !!env.ANTHROPIC_API_KEY,
        allowedUsers: list(env.ALLOWED_USERS).length,
        dailyLimit: env.USAGE ? Number(env.DAILY_LIMIT || 200) : null,
        model: env.MODEL || 'claude-haiku-5-5',
      }, 200, cors);
    }

    if (url.pathname !== '/interpret' || request.method !== 'POST') return json({ error: 'Nicht gefunden' }, 404, cors);
    if (!originOk) return json({ error: 'Diese Web-Adresse ist nicht freigegeben (ALLOWED_ORIGINS).' }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Auf dem Server fehlt der API-Schlüssel (ANTHROPIC_API_KEY).' }, 500, cors);

    const me = await spotifyUser(request.headers.get('Authorization'));
    if (!me) return json({ error: 'Spotify-Anmeldung ungültig – in der App neu anmelden.' }, 401, cors);
    const allowed = list(env.ALLOWED_USERS);
    if (!allowed.includes(me.id)) {
      return json({ error: `Dein Spotify-Konto ist für die KI nicht freigegeben. Trage „${me.id}“ in ALLOWED_USERS ein.`, userId: me.id }, 403, cors);
    }

    const limit = await checkDailyLimit(env, me.id);
    if (!limit.ok) return json({ error: `Tageslimit von ${limit.limit} KI-Anfragen erreicht.` }, 429, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Ungültige Anfrage' }, 400, cors); }
    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return json({ error: 'Kein Wunsch übermittelt' }, 400, cors);
    const artists = cleanStrings(body.artists, MAX_ARTISTS);
    const genres = cleanStrings(body.genres, MAX_GENRES, 80);

    try {
      const { input, usage } = await askClaude(env, text, artists, genres);
      const count = Number.isInteger(input.count) && input.count >= 0 ? input.count : null;
      return json({
        filter: {
          include_artists: keepKnown(input.include_artists, artists),
          exclude_artists: keepKnown(input.exclude_artists, artists),
          include_genres: keepKnown(input.include_genres, genres),
          exclude_genres: keepKnown(input.exclude_genres, genres),
          title_keywords: cleanStrings(input.title_keywords, 10, 60),
          count,
          summary: String(input.summary || '').slice(0, 120),
        },
        usage: usage ? { input: usage.input_tokens, output: usage.output_tokens, cached: usage.cache_read_input_tokens || 0 } : null,
      }, 200, cors);
    } catch (e) {
      return json({ error: e.message }, e.status || 500, cors);
    }
  },
};
