# KI-Worker für Smart Shuffle

Kleiner Mittelsmann auf Cloudflare: nimmt Sprachwünsche aus der App entgegen, prüft den
Spotify-Login und die Freigabeliste und fragt Claude (Haiku 5.5). Außerdem ordnet er einmalig
alle Interpreten der Bibliothek ihren Genres zu (`/tag-artists`), weil Spotify das bei großen
Bibliotheken nur sehr langsam liefert. Der API-Schlüssel liegt nur
hier als Secret, nie auf einem Handy und nie im Repo.

```
iPhone ──Wunsch + Spotify-Token──▶ Worker ──prüft Login, Freigabe, Limit──▶ Claude
   ◀───────────── Filter (Interpreten, Genres, Anzahl) ◀──────────────────────┘
```

## Einrichtung

### 1. API-Schlüssel bei Anthropic
1. <https://platform.claude.com> → anmelden → **Billing**: Guthaben aufladen (z. B. 5 $)
2. **Limits**: ein monatliches Ausgabenlimit setzen
3. **API Keys** → *Create Key* → Schlüssel kopieren (nur einmal sichtbar, nicht in den Chat schicken)

### 2. Worker bei Cloudflare anlegen
1. Kostenloses Konto auf <https://dash.cloudflare.com>
2. **Workers & Pages** → **Create application** → **Import a repository**
3. GitHub verbinden und `servusgruss/smart-shuffle` auswählen
4. Projektname: **smart-shuffle-ki** (muss so heißen wie in `wrangler.toml`)
5. In den Build-Einstellungen das Stammverzeichnis (**Root directory**) auf `worker` setzen
6. **Save and Deploy**. Danach hat der Worker eine Adresse wie
   `https://smart-shuffle-ki.<name>.workers.dev`

Ab jetzt wird jede Änderung im Ordner `worker/` auf GitHub automatisch neu veröffentlicht.

### 3. Schlüssel und Freigabeliste eintragen
Worker öffnen → **Settings** → **Variables and Secrets** → **Add**:

| Name | Typ | Wert |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret** | der Schlüssel aus Schritt 1 |
| `ALLOWED_USERS` | Text | Spotify-IDs, kommagetrennt, z. B. `jannis123,freundin456` |

Die eigene Spotify-ID steht in der App unter **Einstellungen → KI** (antippen kopiert sie).
Wer nicht auf der Liste steht, bekommt eine Fehlermeldung mit seiner ID zum Eintragen.

### 4. In der App verbinden
App → **Einstellungen → KI** → Worker-Adresse eintragen → **Verbindung testen**.
Damit Freunde die Adresse nicht eintippen müssen, kann sie in `config.js` bei `kiUrl`
als Voreinstellung eingetragen werden.

## Last.fm für „Neues entdecken“ (empfohlen)
Last.fm liefert ähnliche Songs aus echten Hördaten („wer X hört, hört auch Y“). Ohne Schlüssel
kommen Vorschläge nur von der KI.
1. Kostenloses Konto auf <https://www.last.fm> (falls noch keins)
2. <https://www.last.fm/api/account/create> öffnen: App-Name z. B. „Smart Shuffle“, kurze
   Beschreibung; Callback-URL leer lassen → **API Key** kopieren (das „Shared Secret“ wird nicht gebraucht)
3. Cloudflare → Worker → **Settings → Variables and Secrets** → **Add**:
   Typ **Secret**, Name `LASTFM_API_KEY`, Wert = API Key → **Deploy**
4. In der App **Einstellungen → KI → Verbindung testen**: dort steht dann „Last.fm eingerichtet“

In der App steuern zwei Regler unter **Einstellungen → Neues entdecken**:
- **Neue Songs pro Mix** (0–50): zugleich die Höchstzahl an Spotify-Suchen pro Mix; 0 schaltet alles ab
- **Herkunft** von „nur Last.fm“ bis „nur KI“: an den Enden ist die jeweils andere Quelle komplett aus.
  Liefert Last.fm zu wenig, ergänzt die KI – außer sie steht auf aus.

## Optional: Tageslimit pro Person
1. Cloudflare → **Storage & Databases → KV** → Namespace `smart-shuffle-usage` anlegen
2. In `wrangler.toml` den Block `[[kv_namespaces]]` einkommentieren und die ID eintragen
3. `DAILY_LIMIT` (Standard 200) begrenzt dann die KI-Anfragen pro Person und Tag

## Kosten
- **Cloudflare:** kostenlos (Free-Plan: 100.000 Anfragen pro Tag; die Wartezeit auf Claude
  zählt nicht zur Rechenzeit)
- **Last.fm:** kostenlos; pro Vorschlagsrunde bis zu 8 Abfragen
- **Neue Songs:** pro Mix ein Claude-Aufruf (falls KI-Anteil > 0) und höchstens so viele Spotify-Suchen,
  wie in der App eingestellt
- **Genre-Zuordnung:** einmalig pro Interpret, bei ~2.000 Interpreten grob ein paar Cent
- **Claude Haiku 5.5:** pro Sprachbefehl wird die Interpreten- und Genreliste mitgeschickt.
  Bei ~1.000 Interpreten grob ein Bruchteil eines Cents pro Befehl; die Liste wird zwischengespeichert
  (Prompt Caching), wiederholte Befehle kurz hintereinander sind günstiger.

## Sicherheit
- Nur Anfragen von der App-Adresse (`ALLOWED_ORIGINS`) werden angenommen
- Jede Anfrage braucht einen gültigen Spotify-Login, und die Spotify-ID muss in `ALLOWED_USERS` stehen
- Ein geprüfter Login wird 50 Minuten wiedererkannt (nur ein Hash, nie der Schlüssel selbst) –
  so kostet nicht jede KI-Anfrage eine Spotify-Anfrage. Bremst Spotify, fragt der Worker eine
  Weile gar nicht erst nach und meldet „Spotify bremst gerade“ (HTTP 503)
- Die KI darf nur Interpreten und Genres zurückgeben, die wirklich in der Bibliothek stehen –
  alles andere filtert der Worker heraus
- Es wird nichts gespeichert (außer dem Zähler fürs Tageslimit, falls aktiviert)

## Test ohne Netz
`node test/worker.test.mjs` im Hauptordner – simuliert Spotify und Claude.
