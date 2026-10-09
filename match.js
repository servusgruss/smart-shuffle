/* Smart Shuffle – Kriterien verstehen und unscharf zuordnen.
 *
 * Ablauf: gesprochener/getippter Satz → parseQuery() zerlegt ihn in
 * „nur …“ / „ohne …“-Begriffe → resolveTerm() ordnet jeden Begriff einem
 * Interpreten, Genre oder Songtitel aus DEINER Bibliothek zu – auch wenn die
 * Spracherkennung ihn falsch geschrieben hat („Kraft Club“ → Kraftklub).
 * Dafür werden Tippabstand (Levenshtein) und deutsche Aussprache
 * (Kölner Phonetik) kombiniert. Läuft komplett lokal, ohne KI-Dienst.
 */
(function (root) {
  'use strict';

  /* ---------- Hilfsfunktionen ---------- */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' und ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const ARTICLE = /^(the|die|der|das|les|la|le|los|el) /;
  const compact = (s) => s.replace(/ /g, '');

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  const similarity = (a, b) => (a.length || b.length) ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1;

  /* Kölner Phonetik: gleiche Codes für ähnlich klingende deutsche Wörter. */
  function koelner(word) {
    const s = String(word || '').toUpperCase()
      .replace(/Ä/g, 'A').replace(/Ö/g, 'O').replace(/Ü/g, 'U').replace(/ß/g, 'S')
      .replace(/[^A-Z]/g, '');
    let codes = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i], prev = s[i - 1] || '', next = s[i + 1] || '';
      let code = '';
      if ('AEIJOUY'.includes(c)) code = '0';
      else if (c === 'H') code = '';
      else if (c === 'B') code = '1';
      else if (c === 'P') code = next === 'H' ? '3' : '1';
      else if (c === 'D' || c === 'T') code = 'CSZ'.includes(next) && next ? '8' : '2';
      else if ('FVW'.includes(c)) code = '3';
      else if ('GKQ'.includes(c)) code = '4';
      else if (c === 'C') {
        if (i === 0) code = 'AHKLOQRUX'.includes(next) && next ? '4' : '8';
        else if ('SZ'.includes(prev) && prev) code = '8';
        else code = 'AHKOQUX'.includes(next) && next ? '4' : '8';
      } else if (c === 'X') code = 'CKQ'.includes(prev) && prev ? '8' : '48';
      else if (c === 'L') code = '5';
      else if (c === 'M' || c === 'N') code = '6';
      else if (c === 'R') code = '7';
      else if (c === 'S' || c === 'Z') code = '8';
      codes += code;
    }
    let out = '';
    for (const ch of codes) if (ch !== out[out.length - 1]) out += ch;
    return out ? out[0] + out.slice(1).replace(/0/g, '') : '';
  }

  /* Lockere Schreibweise: gleicht typische Englisch/Deutsch-Hörfehler an
   * (Craft/Kraft, Apatsche/Apache, Shiran/Sheeran, Kro/Cro). */
  function loose(s) {
    return compact(normalize(s))
      .replace(/[0-9]/g, '')
      .replace(/tsch/g, 'ch').replace(/sch/g, 'sh').replace(/ph/g, 'f').replace(/th/g, 't')
      .replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/c(?=[aoulrkt]|$)/g, 'k').replace(/x/g, 'ks')
      .replace(/ee|ea|ie|y/g, 'i').replace(/ou/g, 'u').replace(/dt|tt/g, 't').replace(/tz|z/g, 's')
      .replace(/v/g, 'f').replace(/w/g, 'v').replace(/h(?![aeiou])/g, '')
      .replace(/(.)\1+/g, '$1');
  }
  const phonetic = (s) => normalize(s).split(' ').map(koelner).join('');

  /* ---------- Sprache → Kriterien ---------- */
  const NUMBER_WORDS = {
    zehn: 10, zwanzig: 20, dreissig: 30, dreißig: 30, vierzig: 40, fuenfzig: 50, fünfzig: 50,
    hundert: 100, einhundert: 100, zweihundert: 200, dreihundert: 300, fuenfhundert: 500, fünfhundert: 500,
  };
  const NEGATIVE = /\b(ohne|kein|keine|keinen|keinem|keiner|nicht|ausser|außer|bloss kein|bloß kein)\b/;
  const FILLER = /\b(songs?|lieder?|liedern|titel|tracks?|musik|bitte|spiel(e|t)?|abspielen|mische?n?|mir|mal|nur|von|vom|mit|ohne|keine[nmr]?|kein|nicht|ausser|außer|etwas|was|shuffle|shuffel|aus|meine[nm]?|gespeicherten|lieblingssongs|lieblingslieder|letzten|neuesten|alle[ns]?|ich|will|möchte|moechte|hören|hoeren|gerne?|bisschen|\d+|zehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|hundert|einhundert|zweihundert|dreihundert|fünfhundert|fuenfhundert)\b/g;

  function parseQuery(text) {
    const result = { include: [], exclude: [], count: null };
    const lower = String(text || '').toLowerCase();
    const n = lower.match(/(?:letzten|neuesten)\s+(\d+|[a-zäöüß]+)/);
    if (n) result.count = /^\d+$/.test(n[1]) ? Number(n[1]) : NUMBER_WORDS[n[1]] || null;
    if (/\balle[ns]?\b/.test(lower) && !n) result.count = Infinity;
    for (const clause of lower.split(/,|;|\bund\b|\baber\b|\bsowie\b|\boder\b/)) {
      const negative = NEGATIVE.test(clause);
      const term = clause
        .replace(/\b(die|der|das|den|dem|des)\b(?=.*\b(songs?|lieder|musik)\b)/g, ' ') // „die Songs von …“
        .replace(FILLER, ' ')
        .replace(/[„“"'.!?]/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^(den|dem|der|die|das|des)\s+/, '');
      if (!term || term.length < 2) continue;
      (negative ? result.exclude : result.include).push(term);
    }
    return result;
  }

  /* ---------- Begriffe der Bibliothek zuordnen ---------- */
  const GENRE_WORDS = {
    rap: ['rap', 'hip hop'], hiphop: ['hip hop', 'rap'], 'hip hop': ['hip hop', 'rap'],
    deutschrap: ['german hip hop', 'deutschrap', 'german rap'], 'deutsch rap': ['german hip hop', 'deutschrap', 'german rap'],
    elektro: ['electro', 'electronic', 'house', 'techno', 'edm'], elektronisch: ['electro', 'electronic', 'house', 'techno', 'edm'],
    techno: ['techno'], house: ['house'], klassik: ['classical', 'klassik'], klassische: ['classical'],
    schlager: ['schlager'], metal: ['metal'], rock: ['rock'], pop: ['pop'], indie: ['indie'], jazz: ['jazz'],
    punk: ['punk'], soul: ['soul'], funk: ['funk'], reggae: ['reggae'], country: ['country'], blues: ['blues'],
    deutschpop: ['german pop', 'deutschpop'], 'deutsch pop': ['german pop', 'deutschpop'],
    'r and b': ['r&b', 'rnb'], rnb: ['r&b', 'rnb'], latin: ['latin', 'reggaeton'],
  };

  /* index: { artists: [{id,name,norm,bare,comp,phon}], genres: [norm…] } */
  function buildIndex(tracks, genresByArtist) {
    const artists = new Map();
    for (const t of tracks) for (const a of t.artists) {
      if (!artists.has(a.name)) {
        const norm = normalize(a.name);
        const bare = norm.replace(ARTICLE, '');
        artists.set(a.name, { name: a.name, norm, bare, comp: compact(bare), phon: phonetic(bare), loose: loose(bare) });
      }
    }
    const genres = new Set();
    for (const list of Object.values(genresByArtist || {})) for (const g of list) genres.add(normalize(g));
    return { artists: [...artists.values()], genres: [...genres] };
  }

  function artistScore(term, a) {
    const t = normalize(term).replace(ARTICLE, '');
    if (!t) return 0;
    if (t === a.bare || t === a.norm) return 1;
    const tc = compact(t);
    if (tc === a.comp) return 0.99;
    let score = Math.max(similarity(tc, a.comp), similarity(t, a.bare));
    const tl = loose(t);
    // Kurze Namen (Cro, Sido) nur bei sehr hoher Ähnlichkeit, sonst zu viele Fehltreffer
    if (Math.min(tc.length, a.comp.length) <= 3 && score < 0.99) score *= 0.7;
    // Aussprache: „Kraft Club“ ≈ „Kraftklub“, „Kro“ ≈ „Cro“
    if (tl && tl === a.loose) score = Math.max(score, 0.92);
    else if (tl.length >= 4 && a.loose.length >= 4) score = Math.max(score, similarity(tl, a.loose) * 0.95);
    if (tc.length >= 3 && a.phon && phonetic(t) === a.phon) score = Math.max(score, 0.93);
    // Teilwort: „Annenmay“ → AnnenMayKantereit
    if (tc.length >= 5 && a.comp.startsWith(tc)) score = Math.max(score, 0.86);
    return score;
  }

  /* Liefert {type:'artist'|'genre'|'text', label, values, fixed} */
  function resolveTerm(term, index) {
    const t = normalize(term);
    if (GENRE_WORDS[t]) return { type: 'genre', label: term, values: GENRE_WORDS[t], fixed: false };

    let best = null, bestScore = 0;
    for (const a of index.artists) {
      const s = artistScore(t, a);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    if (best && bestScore >= 0.78) {
      return { type: 'artist', label: best.name, values: [best.norm], fixed: best.norm !== t && best.bare !== t, score: bestScore };
    }

    if (index.genres.some((g) => g.includes(t))) return { type: 'genre', label: term, values: [t], fixed: false };
    let bestGenre = null, bestG = 0;
    for (const g of index.genres) {
      const s = Math.max(similarity(t, g), ...g.split(' ').map((w) => similarity(t, w)));
      if (s > bestG) { bestG = s; bestGenre = g; }
    }
    if (bestGenre && bestG >= 0.8 && t.length >= 4) return { type: 'genre', label: bestGenre, values: [bestGenre], fixed: true };

    return { type: 'text', label: term, values: [t], fixed: false };
  }

  function trackMatches(track, resolved, genresByArtist) {
    const vals = resolved.values;
    if (resolved.type === 'artist') return track.artists.some((a) => vals.includes(normalize(a.name)));
    if (resolved.type === 'genre') {
      const gs = track.artists.flatMap((a) => (genresByArtist[a.id] || []).map(normalize));
      return gs.some((g) => vals.some((v) => g.includes(normalize(v))));
    }
    const hay = normalize([track.name, track.album, ...track.artists.map((a) => a.name)].join(' '));
    return vals.some((v) => hay.includes(v));
  }

  const api = { normalize, levenshtein, koelner, loose, phonetic, parseQuery, buildIndex, resolveTerm, trackMatches, artistScore };
  root.Matcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
